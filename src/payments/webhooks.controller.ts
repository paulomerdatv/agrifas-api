import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks/asaas')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private prisma: PrismaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleAsaasWebhook(
    @Body() payload: any,
    @Headers('asaas-access-token') webhookToken: string,
  ) {
    try {
      const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;

      if (expectedToken && webhookToken !== expectedToken) {
        this.logger.warn(
          `[ASAAS WEBHOOK] Token inválido recebido. Ignorando.`,
        );
        return { received: false, unauthorized: true };
      }

      this.logger.log(`[ASAAS WEBHOOK] Payload recebido: ${JSON.stringify(payload)}`);

      const event = payload?.event;
      const payment = payload?.payment;

      if (!payment) {
        return { received: true, ignored: true, reason: 'payment_missing' };
      }

      const orderNsu = payment?.externalReference;

      if (!orderNsu) {
        return { received: true, ignored: true, reason: 'external_reference_missing' };
      }

      const order = await this.prisma.order.findUnique({
        where: { orderNsu },
      });

      if (!order) {
        this.logger.warn(`[ASAAS WEBHOOK] Pedido não encontrado: ${orderNsu}`);
        return { received: true, ignored: true, reason: 'order_not_found' };
      }

      // Idempotência
      if (order.status === 'PAID') {
        this.logger.log(
          `[ASAAS WEBHOOK] Pedido ${orderNsu} já está PAGO. Ignorando duplicado.`,
        );
        return { received: true, status: 'already_paid' };
      }

      const providerTransactionNsu = payment?.id || null;
      const receiptUrl = payment?.invoiceUrl || null;
      const paymentStatus = payment?.status;

      // Eventos de pagamento confirmado
      const isPaidEvent =
        event === 'PAYMENT_RECEIVED' ||
        event === 'PAYMENT_CONFIRMED' ||
        (event === 'PAYMENT_UPDATED' &&
          (paymentStatus === 'RECEIVED' || paymentStatus === 'CONFIRMED'));

      if (isPaidEvent) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            providerTransactionNsu,
            receiptUrl,
          },
        });

        this.logger.log(`[ASAAS WEBHOOK] Pedido ${orderNsu} atualizado para PAID.`);
        return { received: true, processed: true, status: 'PAID' };
      }

      // Expirado / vencido
      const isExpiredEvent =
        event === 'PAYMENT_OVERDUE' || paymentStatus === 'OVERDUE';

      if (isExpiredEvent) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'EXPIRED',
            providerTransactionNsu,
            receiptUrl,
          },
        });

        this.logger.log(`[ASAAS WEBHOOK] Pedido ${orderNsu} atualizado para EXPIRED.`);
        return { received: true, processed: true, status: 'EXPIRED' };
      }

      // Cancelado / removido / estornado
      const isCancelledEvent =
        event === 'PAYMENT_DELETED' ||
        event === 'PAYMENT_REFUNDED' ||
        paymentStatus === 'DELETED' ||
        paymentStatus === 'REFUNDED';

      if (isCancelledEvent) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'CANCELLED',
            providerTransactionNsu,
            receiptUrl,
          },
        });

        this.logger.log(
          `[ASAAS WEBHOOK] Pedido ${orderNsu} atualizado para CANCELLED.`,
        );
        return { received: true, processed: true, status: 'CANCELLED' };
      }

      // Qualquer outro evento: apenas registra e mantém PENDING
      this.logger.log(
        `[ASAAS WEBHOOK] Evento ${event} recebido para ${orderNsu}, sem alteração de status.`,
      );

      return { received: true, processed: false, ignoredEvent: event };
    } catch (error: any) {
      this.logger.error(
        `[ASAAS WEBHOOK] Erro ao processar webhook: ${error.message}`,
        error.stack,
      );

      // Sempre 200 pra evitar flood de retries
      return { received: true, processed: false, error: true };
    }
  }
}