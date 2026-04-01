import { Module } from '@nestjs/common';
import { AdminIntegrationsController } from './admin-integrations.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [PaymentsController, WebhooksController, AdminIntegrationsController],
  providers: [PaymentsService, WebhooksService],
  exports: [WebhooksService],
})
export class PaymentsModule {}
