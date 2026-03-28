import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('infinitepay')
  @HttpCode(200)
  async handleInfinitePayWebhook(@Body() body: any) {
    /**
     * IMPORTANTE:
     * Como o payload completo do webhook ainda não foi 100% confirmado,
     * este controller tenta ler os campos mais prováveis sem quebrar.
     *
     * Assim que você tiver um exemplo real do webhook, vale a pena
     * travar isso com DTO específico.
     */

    const orderNsu =
      body?.orderNsu ??
      body?.order_nsu ??
      body?.metadata?.orderNsu ??
      body?.metadata?.order_nsu ??
      body?.reference ??
      body?.reference_id;

    const providerTransactionNsu =
      body?.transactionNsu ??
      body?.transaction_nsu ??
      body?.id ??
      body?.payment_id ??
      null;

    const receiptUrl =
      body?.receiptUrl ??
      body?.receipt_url ??
      body?.payment_receipt_url ??
      null;

    const providerStatusRaw =
      String(
        body?.status ??
          body?.payment_status ??
          body?.invoice_status ??
          '',
      ).toUpperCase();

    if (!orderNsu) {
      return {
        received: true,
        ignored: true,
        reason: 'orderNsu não encontrado no payload',
      };
    }

    const order = await this.prisma.order.findUnique({
      where: { orderNsu },
      include: {
        raffle: true,
      },
    });

    if (!order) {
      return {
        received: true,
        ignored: true,
        reason: 'pedido não encontrado',
      };
    }

    // Idempotência
    if (order.status === 'PAID') {
      return {
        received: true,
        ignored: true,
        reason: 'pedido já estava pago',
      };
    }

    const mappedStatus = this.mapProviderStatus(providerStatusRaw);

    if (!mappedStatus) {
      return {
        received: true,
        ignored: true,
        reason: `status não mapeado: ${providerStatusRaw || 'vazio'}`,
      };
    }

    if (mappedStatus === 'PAID') {
      await this.prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUnique({
          where: { orderNsu },
        });

        if (!currentOrder) {
          return;
        }

        if (currentOrder.status === 'PAID') {
          return;
        }

        await tx.order.update({
          where: { orderNsu },
          data: {
            status: 'PAID',
            providerTransactionNsu,
            receiptUrl,
          },
        });

        await tx.raffle.update({
          where: { id: order.raffleId },
          data: {
            soldTickets: {
              increment: order.selectedTickets.length,
            },
          },
        });
      });

      return {
        received: true,
        processed: true,
        status: 'PAID',
      };
    }

    await this.prisma.order.update({
      where: { orderNsu },
      data: {
        status: mappedStatus,
        providerTransactionNsu,
        receiptUrl,
      },
    });

    return {
      received: true,
      processed: true,
      status: mappedStatus,
    };
  }

  private mapProviderStatus(status: string):
    | 'PENDING'
    | 'PAID'
    | 'FAILED'
    | 'EXPIRED'
    | 'CANCELLED'
    | null {
    if (!status) return null;

    const normalized = status.toUpperCase();

    if (
      ['PAID', 'APPROVED', 'COMPLETED', 'SUCCESS', 'SUCCEEDED'].includes(normalized)
    ) {
      return 'PAID';
    }

    if (
      ['PENDING', 'WAITING', 'WAITING_PAYMENT', 'PROCESSING', 'CREATED'].includes(normalized)
    ) {
      return 'PENDING';
    }

    if (
      ['FAILED', 'REFUSED', 'DENIED', 'ERROR'].includes(normalized)
    ) {
      return 'FAILED';
    }

    if (
      ['EXPIRED', 'TIMEOUT'].includes(normalized)
    ) {
      return 'EXPIRED';
    }

    if (
      ['CANCELLED', 'CANCELED', 'VOIDED'].includes(normalized)
    ) {
      return 'CANCELLED';
    }

    return null;
  }
}