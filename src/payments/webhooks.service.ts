import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WebhookEvent,
  WebhookProcessingStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ListWebhookEventsInput {
  provider?: string;
  status?: string;
  page?: number;
  limit?: number;
}

interface ProcessAsaasWebhookInput {
  payload: any;
  webhookEventId: string;
  webhookToken?: string;
  enforceTokenValidation: boolean;
  incrementReprocess: boolean;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleAsaasWebhook(payload: any, webhookToken?: string) {
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        provider: 'ASAAS',
        eventType: this.normalizeEventType(payload?.event),
        payload: this.toJsonPayload(payload),
        orderNsu: this.normalizeValue(payload?.payment?.externalReference),
        processingStatus: WebhookProcessingStatus.RECEIVED,
      },
    });

    return this.processAsaasWebhook({
      payload,
      webhookEventId: webhookEvent.id,
      webhookToken,
      enforceTokenValidation: true,
      incrementReprocess: false,
    });
  }

  async reprocessWebhookEvent(webhookEventId: string) {
    const webhookEvent = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
    });

    if (!webhookEvent) {
      throw new NotFoundException('Webhook nao encontrado.');
    }

    if (webhookEvent.provider !== 'ASAAS') {
      throw new BadRequestException(
        `Reprocessamento manual indisponivel para provider ${webhookEvent.provider}.`,
      );
    }

    return this.processAsaasWebhook({
      payload: webhookEvent.payload,
      webhookEventId: webhookEvent.id,
      enforceTokenValidation: false,
      incrementReprocess: true,
    });
  }

  async listWebhookEvents(input: ListWebhookEventsInput) {
    const page = this.normalizePage(input.page);
    const limit = this.normalizeLimit(input.limit);
    const skip = (page - 1) * limit;

    const where: Prisma.WebhookEventWhereInput = {};

    const provider = this.normalizeValue(input.provider)?.toUpperCase();
    if (provider && provider !== 'ALL') {
      where.provider = provider;
    }

    const status = this.normalizeValue(input.status)?.toUpperCase();
    if (status && status !== 'ALL' && this.isWebhookStatus(status)) {
      where.processingStatus = status;
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.webhookEvent.count({ where }),
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items: items.map((item) => this.toWebhookSummary(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getWebhookEventById(webhookEventId: string) {
    const webhook = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook nao encontrado.');
    }

    return webhook;
  }

  private async processAsaasWebhook(input: ProcessAsaasWebhookInput) {
    const payload = this.toPlainObject(input.payload);
    const eventType = this.normalizeEventType(payload?.event);
    const payment = payload?.payment;
    const orderNsu = this.normalizeValue(payment?.externalReference);

    await this.prisma.webhookEvent.update({
      where: { id: input.webhookEventId },
      data: {
        payload: this.toJsonPayload(payload),
        eventType,
        orderNsu,
        processingStatus: WebhookProcessingStatus.RECEIVED,
        errorMessage: null,
        processedAt: null,
        ...(input.incrementReprocess
          ? {
              reprocessCount: { increment: 1 },
              lastReprocessedAt: new Date(),
            }
          : {}),
      },
    });

    try {
      if (input.enforceTokenValidation) {
        const expectedToken = this.normalizeValue(process.env.ASAAS_WEBHOOK_TOKEN);
        const receivedToken = this.normalizeValue(input.webhookToken);

        if (expectedToken && receivedToken !== expectedToken) {
          this.logger.warn('[ASAAS WEBHOOK] Token invalido recebido. Ignorando.');
          await this.markWebhookAsFailed(
            input.webhookEventId,
            'invalid_webhook_token',
          );
          return { received: false, unauthorized: true };
        }
      }

      this.logger.log(`[ASAAS WEBHOOK] Payload recebido: ${JSON.stringify(payload)}`);

      if (!payment) {
        await this.markWebhookAsIgnored(input.webhookEventId, 'payment_missing');
        return { received: true, ignored: true, reason: 'payment_missing' };
      }

      if (!orderNsu) {
        await this.markWebhookAsIgnored(
          input.webhookEventId,
          'external_reference_missing',
        );
        return {
          received: true,
          ignored: true,
          reason: 'external_reference_missing',
        };
      }

      const order = await this.prisma.order.findUnique({
        where: { orderNsu },
      });

      if (!order) {
        this.logger.warn(`[ASAAS WEBHOOK] Pedido nao encontrado: ${orderNsu}`);
        await this.markWebhookAsIgnored(input.webhookEventId, 'order_not_found');
        return { received: true, ignored: true, reason: 'order_not_found' };
      }

      const providerTransactionNsu = this.normalizeValue(payment?.id);
      const receiptUrl = this.normalizeValue(payment?.invoiceUrl);
      const paymentStatus = this.normalizeValue(payment?.status)?.toUpperCase();

      const isPaidEvent =
        eventType === 'PAYMENT_RECEIVED' ||
        eventType === 'PAYMENT_CONFIRMED' ||
        (eventType === 'PAYMENT_UPDATED' &&
          (paymentStatus === 'RECEIVED' || paymentStatus === 'CONFIRMED'));

      if (isPaidEvent) {
        if (order.status !== 'PAID') {
          await this.prisma.order.update({
            where: { id: order.id },
            data: {
              status: 'PAID',
              providerTransactionNsu,
              receiptUrl,
            },
          });
          this.logger.log(`[ASAAS WEBHOOK] Pedido ${orderNsu} atualizado para PAID.`);
        } else {
          this.logger.log(
            `[ASAAS WEBHOOK] Pedido ${orderNsu} ja esta PAGO. Ignorando duplicado.`,
          );
        }

        await this.markWebhookAsProcessed(input.webhookEventId);
        return {
          received: true,
          processed: true,
          status: order.status === 'PAID' ? 'already_paid' : 'PAID',
        };
      }

      const isExpiredEvent =
        eventType === 'PAYMENT_OVERDUE' || paymentStatus === 'OVERDUE';

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
        await this.markWebhookAsProcessed(input.webhookEventId);
        return { received: true, processed: true, status: 'EXPIRED' };
      }

      const isCancelledEvent =
        eventType === 'PAYMENT_DELETED' ||
        eventType === 'PAYMENT_REFUNDED' ||
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
        await this.markWebhookAsProcessed(input.webhookEventId);
        return { received: true, processed: true, status: 'CANCELLED' };
      }

      this.logger.log(
        `[ASAAS WEBHOOK] Evento ${eventType || 'UNKNOWN'} recebido para ${orderNsu}, sem alteracao de status.`,
      );
      await this.markWebhookAsIgnored(input.webhookEventId, 'event_without_status_mapping');
      return { received: true, processed: false, ignoredEvent: eventType };
    } catch (error: any) {
      const errorMessage = this.normalizeValue(error?.message) || 'unknown_error';

      this.logger.error(
        `[ASAAS WEBHOOK] Erro ao processar webhook: ${errorMessage}`,
        error?.stack,
      );

      await this.markWebhookAsFailed(input.webhookEventId, errorMessage);
      return { received: true, processed: false, error: true };
    }
  }

  private async markWebhookAsProcessed(webhookEventId: string) {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: WebhookProcessingStatus.PROCESSED,
        errorMessage: null,
        processedAt: new Date(),
      },
    });
  }

  private async markWebhookAsIgnored(webhookEventId: string, reason: string) {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: WebhookProcessingStatus.IGNORED,
        errorMessage: this.normalizeValue(reason),
        processedAt: new Date(),
      },
    });
  }

  private async markWebhookAsFailed(webhookEventId: string, errorMessage: string) {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: WebhookProcessingStatus.FAILED,
        errorMessage: this.normalizeValue(errorMessage),
        processedAt: new Date(),
      },
    });
  }

  private normalizePage(page?: number) {
    if (!page || Number.isNaN(page)) return 1;
    return Math.max(1, Math.floor(page));
  }

  private normalizeLimit(limit?: number) {
    if (!limit || Number.isNaN(limit)) return 20;
    return Math.min(100, Math.max(1, Math.floor(limit)));
  }

  private normalizeEventType(value: any) {
    const normalized = this.normalizeValue(value);
    return normalized ? normalized.toUpperCase() : null;
  }

  private normalizeValue(value: any): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized.slice(0, 1000);
  }

  private isWebhookStatus(value: string): value is WebhookProcessingStatus {
    return (
      value === WebhookProcessingStatus.RECEIVED ||
      value === WebhookProcessingStatus.PROCESSED ||
      value === WebhookProcessingStatus.IGNORED ||
      value === WebhookProcessingStatus.FAILED
    );
  }

  private toJsonPayload(payload: any): Prisma.InputJsonValue {
    return this.toPlainObject(payload) as Prisma.InputJsonValue;
  }

  private toPlainObject(payload: any): Record<string, any> {
    if (payload && typeof payload === 'object') {
      try {
        return JSON.parse(JSON.stringify(payload));
      } catch {
        return { raw: String(payload) };
      }
    }

    if (payload === null || payload === undefined) {
      return {};
    }

    return { raw: String(payload) };
  }

  private toWebhookSummary(item: WebhookEvent) {
    return {
      id: item.id,
      provider: item.provider,
      eventType: item.eventType,
      processingStatus: item.processingStatus,
      errorMessage: item.errorMessage,
      orderNsu: item.orderNsu,
      createdAt: item.createdAt,
      processedAt: item.processedAt,
      reprocessCount: item.reprocessCount,
      lastReprocessedAt: item.lastReprocessedAt,
    };
  }
}
