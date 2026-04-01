import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WebhooksService } from './webhooks.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/integrations/webhooks')
export class AdminIntegrationsController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  async listWebhooks(
    @Query('provider') provider?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.webhooksService.listWebhookEvents({
      provider,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  async getWebhookById(@Param('id') id: string) {
    return this.webhooksService.getWebhookEventById(id);
  }

  @Patch(':id/reprocess')
  async reprocessWebhook(@Param('id') id: string) {
    const processResult = await this.webhooksService.reprocessWebhookEvent(id);
    const webhook = await this.webhooksService.getWebhookEventById(id);

    return {
      success: true,
      message: 'Webhook reprocessado com sucesso.',
      processResult,
      webhook,
    };
  }
}
