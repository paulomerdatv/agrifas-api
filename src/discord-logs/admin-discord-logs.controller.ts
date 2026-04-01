import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DiscordLogsService } from './discord-logs.service';
import { DiscordLogCategory } from './discord-logs.types';
import { parseDiscordLogCategory } from './discord-logs.utils';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/discord-logs')
export class AdminDiscordLogsController {
  constructor(private readonly discordLogsService: DiscordLogsService) {}

  @Post('test')
  async sendTestLog(
    @Body()
    body: {
      category?: string;
      title?: string;
      description?: string;
    },
    @CurrentUser() user: any,
  ) {
    const category =
      parseDiscordLogCategory(body?.category) || DiscordLogCategory.SYSTEM;
    const title = body?.title || `Teste de log Discord (${category})`;
    const description =
      body?.description ||
      'Evento de teste disparado manualmente pelo painel administrativo.';

    await this.sendByCategory(category, {
      title,
      description,
      fields: [
        { name: 'adminId', value: user?.userId || '-' },
        { name: 'categoria', value: category },
      ],
    });

    return {
      success: true,
      message: 'Log de teste enviado para o Discord (quando configurado).',
      category,
    };
  }

  private async sendByCategory(category: DiscordLogCategory, payload: any) {
    switch (category) {
      case DiscordLogCategory.ERROR:
        return this.discordLogsService.sendErrorLog(payload);
      case DiscordLogCategory.PAYMENT:
        return this.discordLogsService.sendPaymentLog(payload);
      case DiscordLogCategory.AUTH:
        return this.discordLogsService.sendAuthLog(payload);
      case DiscordLogCategory.RAFFLE:
        return this.discordLogsService.sendRaffleLog(payload);
      case DiscordLogCategory.ADMIN:
        return this.discordLogsService.sendAdminLog(payload);
      case DiscordLogCategory.WEBHOOK:
        return this.discordLogsService.sendWebhookLog(payload);
      case DiscordLogCategory.WARNING:
        return this.discordLogsService.sendWarningLog(payload);
      case DiscordLogCategory.SUCCESS:
        return this.discordLogsService.sendSuccessLog(payload);
      case DiscordLogCategory.INFO:
        return this.discordLogsService.sendInfoLog(payload);
      case DiscordLogCategory.SYSTEM:
      default:
        return this.discordLogsService.sendSystemLog(payload);
    }
  }
}
