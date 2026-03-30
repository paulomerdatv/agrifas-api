import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CouponType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAsaasCheckout(jwtUser: any, dto: any) {
    const { raffleId, selectedTickets, customerData, couponCode } = dto;

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

      const raffle = await this.prisma.raffle.findUnique({
        where: { id: raffleId },
      });
      if (!raffle) throw new NotFoundException('Rifa nao encontrada.');

      if (!selectedTickets || selectedTickets.length === 0) {
        throw new BadRequestException('Nenhum numero selecionado.');
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
        (selectedTickets.length * raffle.pricePerTicket).toFixed(2),
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
            selectedTickets,
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
          },
        });
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
      },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa nao encontrada.');
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
}

