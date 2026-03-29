import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createInfinitePayCheckout(
    jwtUser: any,
    raffleOrDto: string | { raffleId: string; selectedTickets: number[] },
    selectedTicketsArg?: number[],
  ) {
    try {
      const raffleId =
        typeof raffleOrDto === 'string' ? raffleOrDto : raffleOrDto.raffleId;

      const selectedTickets =
        typeof raffleOrDto === 'string'
          ? selectedTicketsArg ?? []
          : raffleOrDto.selectedTickets;

      this.logger.log(
        `Iniciando geração de cobrança ASAAS para o usuário ${jwtUser.userId}, Rifa: ${raffleId}`,
      );

      const user = await this.prisma.user.findUnique({
        where: { id: jwtUser.userId },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado no banco de dados.');
      }

      const raffle = await this.prisma.raffle.findUnique({
        where: { id: raffleId },
      });

      if (!raffle) {
        throw new NotFoundException('Rifa não encontrada.');
      }

      if (!selectedTickets || selectedTickets.length === 0) {
        throw new BadRequestException('Nenhum número selecionado.');
      }

      // REGRA CORRETA:
      // - PAID bloqueia sempre
      // - PENDING bloqueia só por 10 minutos
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      const existingOrders = await this.prisma.order.findMany({
        where: {
          raffleId,
          OR: [
            {
              status: 'PAID',
            },
            {
              status: 'PENDING',
              createdAt: {
                gte: tenMinutesAgo,
              },
            },
          ],
        },
      });

      const occupiedTickets = existingOrders.flatMap((o) => o.selectedTickets);
      const hasConflict = selectedTickets.some((t) => occupiedTickets.includes(t));

      if (hasConflict) {
        throw new BadRequestException(
          'Algumas cotas selecionadas já estão reservadas ou vendidas.',
        );
      }

      const totalAmount = Number(selectedTickets.length * raffle.pricePerTicket);

      const orderNsu = `AG-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;

      // 1) Cria pedido local PENDING
      const order = await this.prisma.order.create({
        data: {
          userId: user.id,
          raffleId,
          selectedTickets,
          totalAmount,
          status: 'PENDING',
          provider: 'ASAAS',
          orderNsu,
        },
      });

      const asaasApiKey = process.env.ASAAS_API_KEY;
      const asaasBaseUrl = process.env.ASAAS_BASE_URL || 'https://api.asaas.com';

      if (!asaasApiKey) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          'ASAAS_API_KEY não configurada no ambiente.',
        );
      }

      // 2) Criar cliente no Asaas
      // Estratégia simples e robusta:
      // sempre cria cliente novo por enquanto (evita depender de search incerto)
      const customerPayload = {
        name: user.name || 'Cliente AGRifas',
        email: user.email || undefined,
        mobilePhone: (user as any).phone || undefined,
      };

      const customerResponse = await fetch(`${asaasBaseUrl}/v3/customers`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          access_token: asaasApiKey,
        },
        body: JSON.stringify(customerPayload),
      });

      const customerData = await customerResponse.json();

      if (!customerResponse.ok || !customerData?.id) {
        this.logger.error(
          `[ASAAS] Erro ao criar cliente: ${JSON.stringify(customerData)}`,
        );

        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          'Falha ao criar cliente no Asaas.',
        );
      }

      const asaasCustomerId = customerData.id;

      // 3) Criar cobrança PIX
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);

      const dueDateStr = dueDate.toISOString().split('T')[0];

      const paymentPayload = {
        customer: asaasCustomerId,
        billingType: 'PIX',
        value: totalAmount,
        dueDate: dueDateStr,
        description: `AGRifas - ${raffle.title} - cotas ${selectedTickets.join(', ')}`,
        externalReference: orderNsu,
      };

      const paymentResponse = await fetch(`${asaasBaseUrl}/v3/payments`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          access_token: asaasApiKey,
        },
        body: JSON.stringify(paymentPayload),
      });

      const paymentData = await paymentResponse.json();

      if (!paymentResponse.ok || !paymentData?.id) {
        this.logger.error(
          `[ASAAS] Erro ao criar cobrança PIX: ${JSON.stringify(paymentData)}`,
        );

        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          'Falha ao criar cobrança PIX no Asaas.',
        );
      }

      // 4) Buscar QR Code PIX
      const pixResponse = await fetch(
        `${asaasBaseUrl}/v3/payments/${paymentData.id}/pixQrCode`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            access_token: asaasApiKey,
          },
        },
      );

      const pixData = await pixResponse.json();

      if (!pixResponse.ok) {
        this.logger.error(
          `[ASAAS] Erro ao buscar QR Code PIX: ${JSON.stringify(pixData)}`,
        );

        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            providerTransactionNsu: paymentData.id,
            receiptUrl: paymentData.invoiceUrl || null,
          },
        });

        throw new InternalServerErrorException(
          'Cobrança criada, mas falha ao obter QR Code PIX.',
        );
      }

      // 5) Salva dados do provedor no pedido
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          providerTransactionNsu: paymentData.id,
          receiptUrl: paymentData.invoiceUrl || null,
        },
      });

      this.logger.log(
        `[ASAAS] Cobrança PIX criada com sucesso. OrderNSU=${orderNsu}, PaymentID=${paymentData.id}`,
      );

      return {
        orderId: order.id,
        orderNsu: order.orderNsu,
        paymentId: paymentData.id,
        invoiceUrl: paymentData.invoiceUrl || null,
        pixPayload: pixData?.payload || null,
        pixEncodedImage: pixData?.encodedImage || null,
        expirationDate:
          pixData?.expirationDate || paymentData?.dueDate || dueDateStr,
      };
    } catch (error: any) {
      this.logger.error(
        `Erro Fatal em createInfinitePayCheckout: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Erro interno inesperado ao processar o pagamento.',
      );
    }
  }

  async checkPaymentStatus(orderNsu: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNsu },
      select: {
        id: true,
        status: true,
        receiptUrl: true,
        totalAmount: true,
        orderNsu: true,
        provider: true,
        providerTransactionNsu: true,
        createdAt: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado.');
    }

    return order;
  }

  async checkOrderStatus(orderNsu: string) {
    return this.checkPaymentStatus(orderNsu);
  }
}