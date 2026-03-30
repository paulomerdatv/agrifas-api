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
    const { raffleId, selectedTickets, customerData } = dto;

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

      const sanitizeDigits = (value?: string) => (value || '').replace(/\D/g, '');
      const sanitizeText = (value?: string) => (value || '').trim();
      const customerCpfCnpj =
        sanitizeDigits(customerData?.cpfCnpj) ||
        sanitizeDigits((user as any).cpfCnpj) ||
        sanitizeDigits((user as any).cpf) ||
        '65929587000163';

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
          customerFullName: sanitizeText(customerData?.fullName) || sanitizeText(user.name),
          customerEmail: sanitizeText(customerData?.email) || sanitizeText(user.email),
          customerWhatsapp: sanitizeText(customerData?.whatsapp) || null,
          customerTradeLink: sanitizeText(customerData?.tradeLink) || null,
          customerCpfCnpj: customerCpfCnpj || null,
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

      const customerPayload: any = {
        name: sanitizeText(customerData?.fullName) || sanitizeText(user.name),
        email: sanitizeText(customerData?.email) || sanitizeText(user.email),
        cpfCnpj: customerCpfCnpj,
      };

      const mobilePhone = sanitizeDigits(
        customerData?.whatsapp || (user as any).mobilePhone,
      );
      if (mobilePhone) {
        customerPayload.mobilePhone = mobilePhone;
      }

      this.logger.log(
        `[Asaas] Criando cliente: ${customerPayload.name} / ${customerPayload.email}`,
      );

      const customerRes = await fetch(`${baseUrl}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          access_token: apiKey,
        },
        body: JSON.stringify(customerPayload),
      });

      const customerContentType = customerRes.headers.get('content-type') || '';
      const customerRaw = await customerRes.text();

      this.logger.log(
        `[Asaas] /customers status=${customerRes.status} content-type=${customerContentType} body=${customerRaw.slice(0, 1000)}`,
      );

      let customerDataResponse: any = null;
      try {
        customerDataResponse =
          customerRaw && customerContentType.includes('application/json')
            ? JSON.parse(customerRaw)
            : { raw: customerRaw };
      } catch {
        customerDataResponse = { raw: customerRaw };
      }

      if (!customerRes.ok) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          `Erro ao registrar cliente no Asaas: ${
            customerDataResponse?.errors?.[0]?.description ||
            customerDataResponse?.raw ||
            'resposta inválida do Asaas'
          }`,
        );
      }

      if (!customerDataResponse?.id) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          `Asaas não retornou um customer.id válido. Resposta: ${customerRaw.slice(0, 300)}`,
        );
      }

      this.logger.log(
        `[Asaas] Cliente criado/recuperado com sucesso. ID: ${customerDataResponse.id}`,
      );

      const paymentPayload = {
        customer: customerDataResponse.id,
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
          Accept: 'application/json',
          access_token: apiKey,
        },
        body: JSON.stringify(paymentPayload),
      });

      const paymentContentType = paymentRes.headers.get('content-type') || '';
      const paymentRaw = await paymentRes.text();

      this.logger.log(
        `[Asaas] /payments status=${paymentRes.status} content-type=${paymentContentType} body=${paymentRaw.slice(0, 1000)}`,
      );

      let paymentData: any = null;
      try {
        paymentData =
          paymentRaw && paymentContentType.includes('application/json')
            ? JSON.parse(paymentRaw)
            : { raw: paymentRaw };
      } catch {
        paymentData = { raw: paymentRaw };
      }

      if (!paymentRes.ok) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          `Erro ao gerar a cobrança PIX: ${
            paymentData?.errors?.[0]?.description ||
            paymentData?.raw ||
            'resposta inválida do Asaas'
          }`,
        );
      }

      if (!paymentData?.id) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          `Asaas não retornou um payment.id válido. Resposta: ${paymentRaw.slice(0, 300)}`,
        );
      }

      this.logger.log(`[Asaas] Cobrança criada. ID: ${paymentData.id}`);

      const qrCodeRes = await fetch(
        `${baseUrl}/payments/${paymentData.id}/pixQrCode`,
        {
          headers: {
            Accept: 'application/json',
            access_token: apiKey,
          },
        },
      );

      const qrCodeContentType = qrCodeRes.headers.get('content-type') || '';
      const qrCodeRaw = await qrCodeRes.text();

      this.logger.log(
        `[Asaas] /payments/${paymentData.id}/pixQrCode status=${qrCodeRes.status} content-type=${qrCodeContentType} body=${qrCodeRaw.slice(0, 1000)}`,
      );

      let qrCodeData: any = null;
      try {
        qrCodeData =
          qrCodeRaw && qrCodeContentType.includes('application/json')
            ? JSON.parse(qrCodeRaw)
            : { raw: qrCodeRaw };
      } catch {
        qrCodeData = { raw: qrCodeRaw };
      }

      if (!qrCodeRes.ok) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          `Erro ao gerar o QR Code do PIX: ${
            qrCodeData?.errors?.[0]?.description ||
            qrCodeData?.raw ||
            'resposta inválida do Asaas'
          }`,
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
        pixPayload: qrCodeData?.payload,
        pixEncodedImage: qrCodeData?.encodedImage,
        expirationDate: qrCodeData?.expirationDate,
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

  async createInfinitePayCheckout(
    user: any,
    raffleId: string,
    selectedTickets: number[],
  ) {
    return this.createAsaasCheckout(user, { raffleId, selectedTickets });
  }

  async checkPaymentStatus(orderNsu: string) {
    return this.checkOrderStatus(orderNsu);
  }
}
