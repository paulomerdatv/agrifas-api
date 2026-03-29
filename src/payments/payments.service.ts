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

  async createAsaasCheckout(jwtUser: any, dto: any) {
    const { raffleId, selectedTickets } = dto;

    try {
      this.logger.log(
        `Iniciando checkout Asaas para usuário ${jwtUser.userId}, Rifa: ${raffleId}`,
      );

      const user = await this.prisma.user.findUnique({
        where: { id: jwtUser.userId },
      });
      if (!user) throw new NotFoundException('Usuário não encontrado.');

      const raffle = await this.prisma.raffle.findUnique({
        where: { id: raffleId },
      });
      if (!raffle) throw new NotFoundException('Rifa não encontrada.');

      if (!selectedTickets || selectedTickets.length === 0) {
        throw new BadRequestException('Nenhum número selecionado.');
      }

      const existingOrders = await this.prisma.order.findMany({
        where: {
          raffleId,
          status: { in: ['PAID', 'PENDING'] },
        },
      });

      const occupiedTickets = existingOrders.flatMap((o) => o.selectedTickets);
      const hasConflict = selectedTickets.some((t) =>
        occupiedTickets.includes(t),
      );

      if (hasConflict) {
        throw new BadRequestException(
          'Algumas cotas selecionadas já foram reservadas ou vendidas.',
        );
      }

      const totalAmount = selectedTickets.length * raffle.pricePerTicket;
      const orderNsu = `AG-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;

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

      const apiKey = process.env.ASAAS_API_KEY;
      const baseUrl =
        process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3';

      if (!apiKey) {
        this.logger.error('ASAAS_API_KEY não configurada no .env');
        throw new InternalServerErrorException(
          'Configuração de pagamento ausente no servidor.',
        );
      }

      const customerCpfCnpj =
        (user as any).cpfCnpj || (user as any).cpf || '65929587000163';
      const customerMobilePhone = (user as any).mobilePhone || undefined;

      const customerPayload = {
        name: user.name,
        email: user.email,
        cpfCnpj: customerCpfCnpj,
        mobilePhone: customerMobilePhone,
      };

      this.logger.log(
        `[Asaas] Criando cliente: ${customerPayload.name} / ${customerPayload.email}`,
      );

      const customerRes = await fetch(`${baseUrl}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: apiKey,
        },
        body: JSON.stringify(customerPayload),
      });

      const customerData = await customerRes.json();

      if (!customerRes.ok) {
        this.logger.error(
          `[Asaas] Erro ao criar cliente: ${JSON.stringify(customerData)}`,
        );
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });
        throw new InternalServerErrorException(
          'Erro ao registrar cliente no provedor de pagamento.',
        );
      }

      this.logger.log(
        `[Asaas] Cliente criado/recuperado com sucesso. ID: ${customerData.id}`,
      );

      const paymentPayload = {
        customer: customerData.id,
        billingType: 'PIX',
        value: totalAmount,
        dueDate: new Date().toISOString().split('T')[0],
        description: `Pedido ${orderNsu} - ${raffle.title}`,
        externalReference: orderNsu,
      };

      this.logger.log(`[Asaas] Criando cobrança PIX para o pedido ${orderNsu}`);

      const paymentRes = await fetch(`${baseUrl}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: apiKey,
        },
        body: JSON.stringify(paymentPayload),
      });

      const paymentData = await paymentRes.json();

      if (!paymentRes.ok) {
        this.logger.error(
          `[Asaas] Erro ao criar cobrança: ${JSON.stringify(paymentData)}`,
        );
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });
        throw new InternalServerErrorException('Erro ao gerar a cobrança PIX.');
      }

      this.logger.log(`[Asaas] Cobrança criada. ID: ${paymentData.id}`);

      const qrCodeRes = await fetch(`${baseUrl}/payments/${paymentData.id}/pixQrCode`, {
        headers: {
          access_token: apiKey,
        },
      });

      const qrCodeData = await qrCodeRes.json();

      if (!qrCodeRes.ok) {
        this.logger.error(
          `[Asaas] Erro ao buscar QR Code: ${JSON.stringify(qrCodeData)}`,
        );
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });
        throw new InternalServerErrorException(
          'Erro ao gerar o QR Code do PIX.',
        );
      }

      this.logger.log(
        `[Asaas] QR Code recuperado com sucesso para o pedido ${orderNsu}.`,
      );

      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          providerTransactionNsu: paymentData.id,
          receiptUrl: paymentData.invoiceUrl,
        },
      });

      return {
        orderId: order.id,
        orderNsu: order.orderNsu,
        paymentId: paymentData.id,
        invoiceUrl: paymentData.invoiceUrl,
        pixPayload: qrCodeData.payload,
        pixEncodedImage: qrCodeData.encodedImage,
        expirationDate: qrCodeData.expirationDate,
      };
    } catch (error: any) {
      this.logger.error(
        `[Asaas Checkout Error] ${error.message}`,
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
        'Falha interna ao gerar pagamento PIX dinâmico.',
      );
    }
  }

  async checkOrderStatus(orderNsu: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNsu },
      select: {
        id: true,
        status: true,
        receiptUrl: true,
        totalAmount: true,
        providerTransactionNsu: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado.');
    }

    return order;
  }

  async createInfinitePayCheckout(user: any, raffleId: string, selectedTickets: number[]) {
    return this.createAsaasCheckout(user, { raffleId, selectedTickets });
  }

  async checkPaymentStatus(orderNsu: string) {
    return this.checkOrderStatus(orderNsu);
  }
}