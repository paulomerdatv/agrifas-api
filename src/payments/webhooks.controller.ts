import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks/asaas')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleAsaasWebhook(
    @Body() payload: any,
    @Headers('asaas-access-token') webhookToken: string,
  ) {
    return this.webhooksService.handleAsaasWebhook(payload, webhookToken);
  }
}
