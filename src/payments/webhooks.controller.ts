import { Controller, Post, Body, Headers, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks/infinitepay')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private prisma: PrismaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleInfinitePayWebhook(
    @Body() payload: any,
    @Headers('x-infinitepay-signature') signature: string
  ) {
    this.logger.log(`Webhook InfinitePay recebido: ${JSON.stringify(payload)}`);

    // DICA DE SEGURANÇA: Em produção, você DEVE validar a "signature" do webhook 
    // cruzando com o INFINITEPAY_WEBHOOK_SECRET para garantir que a origem é a InfinitePay.

    const { order_nsu, status, transaction_nsu, receipt_url } = payload;

    if (!order_nsu) {
      return { received: true, ignored: true, reason: 'order_nsu_missing' };
    }

    // 1. Localizar o pedido pelo NSU único
    const order = await this.prisma.order.findUnique({
      where: { orderNsu: order_nsu }
    });

    if (!order) {
      this.logger.warn(`Pedido não encontrado para NSU: ${order_nsu}`);
      return { received: true, ignored: true, reason: 'order_not_found' };
    }

    // 2. Garantir a Idempotência (Evitar processamento duplicado)
    if (order.status === 'PAID') {
      this.logger.log(`Pedido ${order_nsu} já estava marcado como PAGO. Ignorando webhook duplicado.`);
      return { received: true, status: 'already_paid' };
    }

    // 3. Atualizar status com base no payload do provedor
    if (status === 'paid' || status === 'approved') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          providerTransactionNsu: transaction_nsu,
          receiptUrl: receipt_url,
        }
      });
      this.logger.log(`Pedido ${order_nsu} atualizado para PAGO com sucesso.`);
    } 
    else if (status === 'expired' || status === 'canceled' || status === 'declined') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: status === 'expired' ? 'EXPIRED' : 'CANCELLED' }
      });
      this.logger.log(`Pedido ${order_nsu} atualizado para ${status}.`);
    }

    // O status HTTP 200 é retornado automaticamente graças ao @HttpCode(HttpStatus.OK)
    // Isso evita que a InfinitePay fique repetindo o envio eternamente.
    return { received: true, processed: true };
  }
}