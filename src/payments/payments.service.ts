import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CouponType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityMonitorService } from '../common/security/security-monitor.service';
import { DiscordLogsService } from '../discord-logs/discord-logs.service';
import { getRaffleUnavailableReason } from '../raffles/raffle-schedule.utils';

interface CouponPreviewResult {
  coupon: {
    id: string;
    code: string;
    type: CouponType;
    value: number;
    usageLimit: number | null;
    usedCount: number;
    active: boolean;
    expiresAt: Date | null;
  };
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
}

interface TrackingOriginInput {
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

interface TrackingOriginData {
  refCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

interface CheckoutRequestContext {
  ipAddress?: string | null;
  route?: string | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly antiFraudConfig = {
    maxTicketsPerOrder: this.readPositiveIntEnv(
      'ANTI_FRAUD_MAX_TICKETS_PER_ORDER',
      120,
    ),
    maxTicketsPerUserPerRaffle: this.readPositiveIntEnv(
      'ANTI_FRAUD_MAX_TICKETS_PER_USER_PER_RAFFLE',
      300,
    ),
    orderCooldownSeconds: this.readPositiveIntEnv(
      'ANTI_FRAUD_ORDER_COOLDOWN_SECONDS',
      10,
    ),
    maxPendingOrdersPerUser: this.readPositiveIntEnv(
      'ANTI_FRAUD_MAX_PENDING_ORDERS_PER_USER',
      5,
    ),
    maxPendingOrdersPerRaffleUser: this.readPositiveIntEnv(
      'ANTI_FRAUD_MAX_PENDING_ORDERS_PER_RAFFLE_USER',
      2,
    ),
    maxPendingTicketsPerRaffleUser: this.readPositiveIntEnv(
      'ANTI_FRAUD_MAX_PENDING_TICKETS_PER_RAFFLE_USER',
      80,
    ),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogsService: DiscordLogsService,
    private readonly securityMonitorService: SecurityMonitorService,
  ) {}

  async createAsaasCheckout(
    jwtUser: any,
    dto: any,
    requestContext: CheckoutRequestContext = {},
  ) {
    const { raffleId, selectedTickets, customerData, couponCode, origin } = dto;

    let order: any = null;
    let appliedCoupon: CouponPreviewResult | null = null;

    try {
      this.logger.log(
        `Iniciando checkout Asaas para usuario ${jwtUser.userId}, Rifa: ${raffleId}`,
      );

      const user = await this.prisma.user.findUnique({
        where: { id: jwtUser.userId },
      });
      if (!user) throw new NotFoundException('Usuario nao encontrado.');

      const trackingOrigin = this.resolveTrackingOrigin(origin, user);

      const raffle = await this.prisma.raffle.findUnique({
        where: { id: raffleId },
      });
      if (!raffle) throw new NotFoundException('Rifa nao encontrada.');

      const raffleUnavailableReason = getRaffleUnavailableReason(raffle, new Date());
      if (raffleUnavailableReason) {
        await this.logSuspiciousCheckoutAttempt(
          'RAFFLE_OUTSIDE_SCHEDULE_WINDOW',
          user.id,
          requestContext,
          {
            raffleId: raffle.id,
            raffleStatus: raffle.status,
            publishAt: raffle.publishAt,
            endAt: raffle.endAt,
          },
        );
        throw new BadRequestException(raffleUnavailableReason);
      }

      if (!Array.isArray(selectedTickets) || selectedTickets.length === 0) {
        await this.logSuspiciousCheckoutAttempt(
          'EMPTY_TICKET_SELECTION',
          jwtUser?.userId,
          requestContext,
          { raffleId },
        );
        throw new BadRequestException('Nenhum numero selecionado.');
      }

      const normalizedTickets = selectedTickets
        .map((ticket: any) => Number(ticket))
        .filter((ticket: number) => Number.isInteger(ticket));
      const uniqueTickets = Array.from(new Set(normalizedTickets));

      if (normalizedTickets.length !== selectedTickets.length) {
        await this.logSuspiciousCheckoutAttempt(
          'INVALID_TICKET_FORMAT',
          user.id,
          requestContext,
          { raffleId, selectedTicketsLength: selectedTickets.length },
        );
        throw new BadRequestException(
          'As cotas informadas sao invalidas. Atualize a pagina e tente novamente.',
        );
      }

      if (uniqueTickets.length !== normalizedTickets.length) {
        await this.logSuspiciousCheckoutAttempt(
          'DUPLICATE_TICKET_SELECTION',
          user.id,
          requestContext,
          {
            raffleId,
            selectedTicketsLength: selectedTickets.length,
            uniqueTicketsLength: uniqueTickets.length,
          },
        );
        throw new BadRequestException(
          'Voce enviou cotas repetidas. Selecione cotas diferentes para continuar.',
        );
      }

      if (uniqueTickets.length > this.antiFraudConfig.maxTicketsPerOrder) {
        await this.logSuspiciousCheckoutAttempt(
          'MAX_TICKETS_PER_ORDER_EXCEEDED',
          user.id,
          requestContext,
          {
            raffleId,
            selectedTicketsLength: uniqueTickets.length,
            maxTicketsPerOrder: this.antiFraudConfig.maxTicketsPerOrder,
          },
        );
        throw new BadRequestException(
          `Limite por pedido excedido. Maximo permitido: ${this.antiFraudConfig.maxTicketsPerOrder} cotas.`,
        );
      }

      const hasOutOfRangeTicket = uniqueTickets.some(
        (ticket) => ticket < 1 || ticket > raffle.totalTickets,
      );
      if (hasOutOfRangeTicket) {
        await this.logSuspiciousCheckoutAttempt(
          'TICKET_OUT_OF_RANGE',
          user.id,
          requestContext,
          {
            raffleId,
            totalTickets: raffle.totalTickets,
          },
        );
        throw new BadRequestException(
          'Existem cotas fora do intervalo da rifa. Atualize a pagina e tente novamente.',
        );
      }

      const cooldownThreshold = new Date(
        Date.now() - this.antiFraudConfig.orderCooldownSeconds * 1000,
      );
      const lastUserOrder = await this.prisma.order.findFirst({
        where: {
          userId: user.id,
          createdAt: { gte: cooldownThreshold },
        },
        select: {
          id: true,
          createdAt: true,
          orderNsu: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (lastUserOrder) {
        const elapsedMs = Date.now() - new Date(lastUserOrder.createdAt).getTime();
        const retryAfterSeconds = Math.max(
          1,
          this.antiFraudConfig.orderCooldownSeconds -
            Math.floor(elapsedMs / 1000),
        );

        await this.logSuspiciousCheckoutAttempt(
          'ORDER_CREATION_COOLDOWN',
          user.id,
          requestContext,
          {
            raffleId,
            retryAfterSeconds,
            orderNsu: lastUserOrder.orderNsu,
          },
        );

        throw new BadRequestException(
          `Aguarde ${retryAfterSeconds}s antes de criar outro pedido.`,
        );
      }

      const pendingOrdersCount = await this.prisma.order.count({
        where: {
          userId: user.id,
          status: 'PENDING',
        },
      });

      if (pendingOrdersCount >= this.antiFraudConfig.maxPendingOrdersPerUser) {
        await this.logSuspiciousCheckoutAttempt(
          'MAX_PENDING_ORDERS_PER_USER_EXCEEDED',
          user.id,
          requestContext,
          {
            pendingOrdersCount,
            maxPendingOrdersPerUser: this.antiFraudConfig.maxPendingOrdersPerUser,
          },
        );
        throw new BadRequestException(
          'Voce possui muitos pedidos pendentes. Finalize ou aguarde expirar para criar novos.',
        );
      }

      const existingOrders = await this.prisma.order.findMany({
        where: {
          raffleId,
          status: { in: ['PAID', 'PENDING'] },
        },
      });

      const userOrdersOnRaffle = existingOrders.filter(
        (order) => order.userId === user.id,
      );
      const userCommittedTicketsInRaffle = userOrdersOnRaffle.reduce(
        (acc, current) => acc + (current.selectedTickets?.length || 0),
        0,
      );

      if (
        userCommittedTicketsInRaffle + uniqueTickets.length >
        this.antiFraudConfig.maxTicketsPerUserPerRaffle
      ) {
        await this.logSuspiciousCheckoutAttempt(
          'MAX_TICKETS_PER_USER_RAFFLE_EXCEEDED',
          user.id,
          requestContext,
          {
            raffleId,
            currentCommittedTickets: userCommittedTicketsInRaffle,
            selectedTicketsLength: uniqueTickets.length,
            maxTicketsPerUserPerRaffle:
              this.antiFraudConfig.maxTicketsPerUserPerRaffle,
          },
        );
        throw new BadRequestException(
          `Limite de cotas por usuario nesta rifa: ${this.antiFraudConfig.maxTicketsPerUserPerRaffle}.`,
        );
      }

      const userPendingOrdersOnRaffle = userOrdersOnRaffle.filter(
        (order) => order.status === 'PENDING',
      );
      const userPendingTicketsOnRaffle = userPendingOrdersOnRaffle.reduce(
        (acc, current) => acc + (current.selectedTickets?.length || 0),
        0,
      );

      if (
        userPendingOrdersOnRaffle.length >=
        this.antiFraudConfig.maxPendingOrdersPerRaffleUser
      ) {
        await this.logSuspiciousCheckoutAttempt(
          'MAX_PENDING_ORDERS_PER_RAFFLE_USER_EXCEEDED',
          user.id,
          requestContext,
          {
            raffleId,
            pendingOrdersOnRaffle: userPendingOrdersOnRaffle.length,
            maxPendingOrdersPerRaffleUser:
              this.antiFraudConfig.maxPendingOrdersPerRaffleUser,
          },
        );
        throw new BadRequestException(
          'Voce atingiu o limite de reservas pendentes nesta rifa.',
        );
      }

      if (
        userPendingTicketsOnRaffle + uniqueTickets.length >
        this.antiFraudConfig.maxPendingTicketsPerRaffleUser
      ) {
        await this.logSuspiciousCheckoutAttempt(
          'MAX_PENDING_TICKETS_PER_RAFFLE_USER_EXCEEDED',
          user.id,
          requestContext,
          {
            raffleId,
            pendingTicketsOnRaffle: userPendingTicketsOnRaffle,
            selectedTicketsLength: uniqueTickets.length,
            maxPendingTicketsPerRaffleUser:
              this.antiFraudConfig.maxPendingTicketsPerRaffleUser,
          },
        );
        throw new BadRequestException(
          'Voce possui cotas pendentes demais nesta rifa. Finalize os pedidos atuais para continuar.',
        );
      }

      const occupiedTickets = existingOrders.flatMap((o) => o.selectedTickets);
      const hasConflict = uniqueTickets.some((t) =>
        occupiedTickets.includes(t),
      );

      if (hasConflict) {
        await this.logSuspiciousCheckoutAttempt(
          'TICKET_CONFLICT_ON_CHECKOUT',
          user.id,
          requestContext,
          {
            raffleId,
            selectedTicketsLength: uniqueTickets.length,
          },
        );
        throw new BadRequestException(
          'Algumas cotas selecionadas ja foram reservadas ou vendidas.',
        );
      }

      const sanitizeDigits = (value?: string) => (value || '').replace(/\D/g, '');
      const sanitizeText = (value?: string) => (value || '').trim();
      const customerCpfCnpj =
        sanitizeDigits(customerData?.cpfCnpj) ||
        sanitizeDigits((user as any).cpfCnpj) ||
        sanitizeDigits((user as any).cpf) ||
        '65929587000163';

      const subtotalAmount = Number(
        (uniqueTickets.length * raffle.pricePerTicket).toFixed(2),
      );
      const orderNsu = `AG-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;

      if (couponCode) {
        appliedCoupon = await this.resolveCouponPreview(couponCode, subtotalAmount);
      }

      const discountAmount = appliedCoupon?.discountAmount || 0;
      const totalAmount = Number((subtotalAmount - discountAmount).toFixed(2));

      if (totalAmount <= 0) {
        throw new BadRequestException(
          'Cupom invalido para este pedido. O valor final precisa ser maior que zero.',
        );
      }

      order = await this.prisma.$transaction(async (tx) => {
        if (appliedCoupon?.coupon) {
          if (typeof appliedCoupon.coupon.usageLimit === 'number') {
            const reserved = await tx.coupon.updateMany({
              where: {
                id: appliedCoupon.coupon.id,
                usedCount: { lt: appliedCoupon.coupon.usageLimit },
              },
              data: {
                usedCount: { increment: 1 },
              },
            });

            if (reserved.count === 0) {
              throw new BadRequestException('Cupom atingiu o limite de uso.');
            }
          } else {
            await tx.coupon.update({
              where: { id: appliedCoupon.coupon.id },
              data: {
                usedCount: { increment: 1 },
              },
            });
          }
        }

        return tx.order.create({
          data: {
            userId: user.id,
            raffleId,
            selectedTickets: uniqueTickets,
            totalAmount,
            subtotalAmount,
            couponDiscountAmount: discountAmount,
            couponCode: appliedCoupon?.coupon.code || null,
            couponId: appliedCoupon?.coupon.id || null,
            status: 'PENDING',
            provider: 'ASAAS',
            orderNsu,
            customerFullName:
              sanitizeText(customerData?.fullName) || sanitizeText(user.name),
            customerEmail:
              sanitizeText(customerData?.email) || sanitizeText(user.email),
            customerWhatsapp: sanitizeText(customerData?.whatsapp) || null,
            customerTradeLink: sanitizeText(customerData?.tradeLink) || null,
            customerCpfCnpj: customerCpfCnpj || null,
            refCode: trackingOrigin.refCode,
            utmSource: trackingOrigin.utmSource,
            utmMedium: trackingOrigin.utmMedium,
            utmCampaign: trackingOrigin.utmCampaign,
          },
        });
      });

      void this.discordLogsService.sendPaymentLog({
        title: 'Pedido PIX criado',
        description: 'Pedido criado para checkout PIX.',
        fields: [
          { name: 'orderId', value: order.id, inline: true },
          { name: 'orderNsu', value: order.orderNsu, inline: true },
          { name: 'userId', value: user.id, inline: true },
          { name: 'raffleId', value: raffleId, inline: true },
          { name: 'subtotal', value: subtotalAmount, inline: true },
          { name: 'total', value: totalAmount, inline: true },
        ],
      });

      const apiKey = process.env.ASAAS_API_KEY;
      const baseUrl = process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3';

      if (!apiKey) {
        this.logger.error('ASAAS_API_KEY nao configurada no .env');
        throw new InternalServerErrorException(
          'Configuracao de pagamento ausente no servidor.',
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
        throw new InternalServerErrorException(
          `Erro ao registrar cliente no Asaas: ${
            customerDataResponse?.errors?.[0]?.description ||
            customerDataResponse?.raw ||
            'resposta invalida do Asaas'
          }`,
        );
      }

      if (!customerDataResponse?.id) {
        throw new InternalServerErrorException(
          `Asaas nao retornou um customer.id valido. Resposta: ${customerRaw.slice(0, 300)}`,
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

      this.logger.log(`[Asaas] Criando cobranca PIX para o pedido ${orderNsu}`);

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
        throw new InternalServerErrorException(
          `Erro ao gerar a cobranca PIX: ${
            paymentData?.errors?.[0]?.description ||
            paymentData?.raw ||
            'resposta invalida do Asaas'
          }`,
        );
      }

      if (!paymentData?.id) {
        throw new InternalServerErrorException(
          `Asaas nao retornou um payment.id valido. Resposta: ${paymentRaw.slice(0, 300)}`,
        );
      }

      this.logger.log(`[Asaas] Cobranca criada. ID: ${paymentData.id}`);

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
        throw new InternalServerErrorException(
          `Erro ao gerar o QR Code do PIX: ${
            qrCodeData?.errors?.[0]?.description ||
            qrCodeData?.raw ||
            'resposta invalida do Asaas'
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

      void this.discordLogsService.sendPaymentLog({
        title: 'Checkout PIX gerado',
        description: 'Checkout PIX criado com sucesso no provedor.',
        fields: [
          { name: 'orderId', value: order.id, inline: true },
          { name: 'orderNsu', value: order.orderNsu, inline: true },
          { name: 'paymentId', value: paymentData.id, inline: true },
          { name: 'status', value: 'PENDING', inline: true },
          { name: 'total', value: totalAmount, inline: true },
        ],
      });

      return {
        orderId: order.id,
        orderNsu: order.orderNsu,
        paymentId: paymentData.id,
        invoiceUrl: paymentData.invoiceUrl,
        pixPayload: qrCodeData?.payload,
        pixEncodedImage: qrCodeData?.encodedImage,
        expirationDate: qrCodeData?.expirationDate,
        subtotalAmount,
        discountAmount,
        totalAmount,
        appliedCoupon: appliedCoupon
          ? {
              code: appliedCoupon.coupon.code,
              type: appliedCoupon.coupon.type,
              value: appliedCoupon.coupon.value,
              discountAmount,
            }
          : null,
      };
    } catch (error: any) {
      if (order?.id) {
        await this.prisma.order
          .update({
            where: { id: order.id },
            data: { status: 'FAILED' },
          })
          .catch(() => null);

        if (order?.couponId) {
          await this.releaseCouponReservation(
            order.id,
            order.couponId,
            order.subtotalAmount,
          );
        }
      }

      this.logger.error(
        `[Asaas Checkout Error] ${error.message}`,
        error.stack,
      );

      void this.discordLogsService.sendPaymentLog({
        title: 'Falha no checkout PIX',
        description: 'Erro ao gerar checkout PIX.',
        fields: [
          { name: 'orderId', value: order?.id || '-', inline: true },
          { name: 'orderNsu', value: order?.orderNsu || '-', inline: true },
          { name: 'raffleId', value: raffleId || '-', inline: true },
          { name: 'userId', value: jwtUser?.userId || '-', inline: true },
          { name: 'erro', value: error?.message || 'erro_desconhecido' },
        ],
      });

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Falha interna ao gerar pagamento PIX dinamico.',
      );
    }
  }

  async validateCouponForCheckout(_jwtUser: any, dto: any) {
    const raffleId = String(dto?.raffleId || '').trim();
    const selectedTickets = Array.isArray(dto?.selectedTickets)
      ? dto.selectedTickets
      : [];
    const couponCode = String(dto?.couponCode || '').trim();

    if (!raffleId) {
      throw new BadRequestException('raffleId e obrigatorio.');
    }

    if (!selectedTickets.length) {
      throw new BadRequestException('Selecione ao menos uma cota para aplicar cupom.');
    }

    if (!couponCode) {
      throw new BadRequestException('Codigo do cupom e obrigatorio.');
    }

    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
      select: {
        id: true,
        title: true,
        pricePerTicket: true,
        status: true,
        publishAt: true,
        endAt: true,
      },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa nao encontrada.');
    }

    const raffleUnavailableReason = getRaffleUnavailableReason(raffle, new Date());
    if (raffleUnavailableReason) {
      throw new BadRequestException(raffleUnavailableReason);
    }

    const subtotalAmount = Number(
      (selectedTickets.length * raffle.pricePerTicket).toFixed(2),
    );
    const preview = await this.resolveCouponPreview(couponCode, subtotalAmount);

    return {
      valid: true,
      coupon: {
        id: preview.coupon.id,
        code: preview.coupon.code,
        type: preview.coupon.type,
        value: preview.coupon.value,
      },
      raffle: {
        id: raffle.id,
        title: raffle.title,
      },
      subtotalAmount: preview.subtotalAmount,
      discountAmount: preview.discountAmount,
      totalAmount: preview.totalAmount,
    };
  }

  async checkOrderStatus(orderNsu: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNsu },
      select: {
        id: true,
        status: true,
        receiptUrl: true,
        totalAmount: true,
        subtotalAmount: true,
        couponCode: true,
        couponDiscountAmount: true,
        refCode: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        providerTransactionNsu: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
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

  private async resolveCouponPreview(
    couponCode: string,
    subtotalAmount: number,
  ): Promise<CouponPreviewResult> {
    const normalizedCode = this.normalizeCouponCode(couponCode);
    if (!normalizedCode) {
      throw new BadRequestException('Codigo do cupom e obrigatorio.');
    }

    if (!Number.isFinite(subtotalAmount) || subtotalAmount <= 0) {
      throw new BadRequestException('Subtotal invalido para aplicacao de cupom.');
    }

    const coupon = await this.prisma.coupon.findUnique({
      where: { code: normalizedCode },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        usageLimit: true,
        usedCount: true,
        active: true,
        expiresAt: true,
      },
    });

    if (!coupon) {
      throw new BadRequestException('Cupom nao encontrado.');
    }

    if (!coupon.active) {
      throw new BadRequestException('Cupom inativo.');
    }

    if (coupon.expiresAt && coupon.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Cupom expirado.');
    }

    if (
      typeof coupon.usageLimit === 'number' &&
      coupon.usedCount >= coupon.usageLimit
    ) {
      throw new BadRequestException('Cupom atingiu o limite de uso.');
    }

    let discountAmount = 0;
    if (coupon.type === CouponType.FIXED) {
      discountAmount = coupon.value;
    } else {
      discountAmount = subtotalAmount * (coupon.value / 100);
    }

    discountAmount = Number(Math.min(subtotalAmount, discountAmount).toFixed(2));
    if (discountAmount <= 0) {
      throw new BadRequestException('Cupom sem desconto valido para este pedido.');
    }

    const totalAmount = Number((subtotalAmount - discountAmount).toFixed(2));
    if (totalAmount <= 0) {
      throw new BadRequestException(
        'Cupom invalido para este pedido. O valor final precisa ser maior que zero.',
      );
    }

    return {
      coupon,
      subtotalAmount,
      discountAmount,
      totalAmount,
    };
  }

  private normalizeCouponCode(raw?: string) {
    return String(raw || '').trim().toUpperCase();
  }

  private resolveTrackingOrigin(
    origin: TrackingOriginInput | undefined,
    user: {
      refCode?: string | null;
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
    },
  ): TrackingOriginData {
    const normalizedFromRequest = this.normalizeTrackingOrigin(origin);
    return {
      refCode: normalizedFromRequest.refCode || this.normalizeOriginValue(user.refCode),
      utmSource:
        normalizedFromRequest.utmSource || this.normalizeOriginValue(user.utmSource),
      utmMedium:
        normalizedFromRequest.utmMedium || this.normalizeOriginValue(user.utmMedium),
      utmCampaign:
        normalizedFromRequest.utmCampaign ||
        this.normalizeOriginValue(user.utmCampaign),
    };
  }

  private normalizeTrackingOrigin(origin?: TrackingOriginInput): TrackingOriginData {
    return {
      refCode: this.normalizeOriginValue(origin?.ref),
      utmSource: this.normalizeOriginValue(origin?.utm_source),
      utmMedium: this.normalizeOriginValue(origin?.utm_medium),
      utmCampaign: this.normalizeOriginValue(origin?.utm_campaign),
    };
  }

  private normalizeOriginValue(raw?: string | null) {
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    return value.slice(0, 120);
  }

  private async releaseCouponReservation(
    orderId: string,
    couponId: string,
    subtotalAmount?: number | null,
  ) {
    await this.prisma
      .$transaction([
        this.prisma.coupon.updateMany({
          where: {
            id: couponId,
            usedCount: { gt: 0 },
          },
          data: {
            usedCount: { decrement: 1 },
          },
        }),
        this.prisma.order.update({
          where: { id: orderId },
          data: {
            couponId: null,
            couponCode: null,
            couponDiscountAmount: 0,
            totalAmount:
              typeof subtotalAmount === 'number' && subtotalAmount > 0
                ? subtotalAmount
                : undefined,
          },
        }),
      ])
      .catch(() => null);
  }

  private readPositiveIntEnv(envKey: string, fallback: number) {
    const raw = Number(process.env[envKey]);
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.floor(raw);
  }

  private async logSuspiciousCheckoutAttempt(
    eventType: string,
    userId: string | null | undefined,
    requestContext: CheckoutRequestContext,
    context?: Record<string, any>,
  ) {
    await this.securityMonitorService.logSuspiciousAttempt({
      eventType,
      severity: 'WARNING',
      userId: userId || null,
      ipAddress: requestContext?.ipAddress || null,
      route: requestContext?.route || 'POST /payments/create-checkout',
      context: context || null,
    });
  }
}
