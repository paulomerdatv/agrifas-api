import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  DISCORD_LOG_CATEGORY_COLORS,
  DISCORD_LOG_CATEGORY_DEFAULT_CHANNEL,
  DISCORD_LOG_CHANNEL_ENV_KEYS,
  DISCORD_LOGS_DEFAULT_TIMEOUT_MS,
  DISCORD_LOGS_FOOTER_TEXT,
  DISCORD_LOGS_LIMITS,
} from './discord-logs.constants';
import {
  DiscordEmbedField,
  DiscordEmbedPayload,
  DiscordLogCategory,
  DiscordLogChannelType,
  DiscordLogPayloadInput,
} from './discord-logs.types';
import {
  parseBooleanEnv,
  parseNumberEnv,
  sanitizeDiscordFields,
  sanitizeDiscordText,
} from './discord-logs.utils';

@Injectable()
export class DiscordLogsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiscordLogsService.name);
  private readonly isEnabled = parseBooleanEnv(
    process.env.DISCORD_LOGS_ENABLED,
    false,
  );
  private readonly logsEnv =
    this.normalizeValue(process.env.DISCORD_LOGS_ENV) ||
    this.normalizeValue(process.env.NODE_ENV) ||
    'development';
  private readonly timeoutMs = parseNumberEnv(
    process.env.DISCORD_LOGS_TIMEOUT_MS,
    DISCORD_LOGS_DEFAULT_TIMEOUT_MS,
  );

  async onApplicationBootstrap() {
    if (!this.isEnabled) {
      this.logger.log('Discord logs estao desativados (DISCORD_LOGS_ENABLED=false).');
      return;
    }

    this.logger.log('Discord logs inicializados.');

    // Fire-and-forget para nao bloquear o bootstrap.
    void this.sendSystemLog({
      title: 'Sistema de logs Discord inicializado',
      description:
        'Infraestrutura de logs multi-webhook pronta para receber eventos.',
      fields: [
        { name: 'Ambiente', value: this.logsEnv, inline: true },
        { name: 'Timeout (ms)', value: this.timeoutMs, inline: true },
      ],
    });
  }

  async sendInfoLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.DEFAULT, {
      ...payload,
      category: DiscordLogCategory.INFO,
    });
  }

  async sendSuccessLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.DEFAULT, {
      ...payload,
      category: DiscordLogCategory.SUCCESS,
    });
  }

  async sendWarningLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.DEFAULT, {
      ...payload,
      category: DiscordLogCategory.WARNING,
    });
  }

  async sendErrorLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.ERRORS, {
      ...payload,
      category: DiscordLogCategory.ERROR,
    });
  }

  async sendPaymentLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.PAYMENTS, {
      ...payload,
      category: DiscordLogCategory.PAYMENT,
    });
  }

  async sendAuthLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.AUTH, {
      ...payload,
      category: DiscordLogCategory.AUTH,
    });
  }

  async sendRaffleLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.RAFFLES, {
      ...payload,
      category: DiscordLogCategory.RAFFLE,
    });
  }

  async sendAdminLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.ADMIN, {
      ...payload,
      category: DiscordLogCategory.ADMIN,
    });
  }

  async sendSystemLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.SYSTEM, {
      ...payload,
      category: DiscordLogCategory.SYSTEM,
    });
  }

  async sendWebhookLog(payload: DiscordLogPayloadInput) {
    return this.sendToDiscord(DiscordLogChannelType.WEBHOOK, {
      ...payload,
      category: DiscordLogCategory.WEBHOOK,
    });
  }

  async sendToDiscord(
    channelType: DiscordLogChannelType,
    payload: DiscordLogPayloadInput,
  ) {
    if (!this.isEnabled) {
      return;
    }

    const webhookUrl = this.resolveWebhookUrl(channelType, payload.category);
    if (!webhookUrl) {
      this.logger.debug(
        `[DiscordLogs] Webhook nao configurado para ${channelType}. Evento ignorado.`,
      );
      return;
    }

    const embed = this.buildEmbed(payload, channelType);

    await this.dispatchToDiscord(webhookUrl, {
      allowed_mentions: { parse: [] },
      embeds: [embed],
    });
  }

  private buildEmbed(
    payload: DiscordLogPayloadInput,
    channelType: DiscordLogChannelType,
  ): DiscordEmbedPayload {
    const category =
      payload.category || this.mapChannelToCategory(channelType);
    const color =
      payload.color || DISCORD_LOG_CATEGORY_COLORS[category] || 0x6b7280;

    const fields: DiscordEmbedField[] = [
      ...sanitizeDiscordFields(payload.fields),
      {
        name: 'Ambiente',
        value: sanitizeDiscordText(this.logsEnv, DISCORD_LOGS_LIMITS.FIELD_VALUE),
        inline: true,
      },
      {
        name: 'Categoria',
        value: sanitizeDiscordText(category, DISCORD_LOGS_LIMITS.FIELD_VALUE),
        inline: true,
      },
      {
        name: 'Timestamp ISO',
        value: new Date().toISOString(),
        inline: false,
      },
    ].slice(0, DISCORD_LOGS_LIMITS.FIELDS_MAX);

    return {
      title: sanitizeDiscordText(payload.title, DISCORD_LOGS_LIMITS.TITLE),
      description: payload.description
        ? sanitizeDiscordText(payload.description, DISCORD_LOGS_LIMITS.DESCRIPTION)
        : undefined,
      color,
      fields,
      footer: {
        text: sanitizeDiscordText(
          DISCORD_LOGS_FOOTER_TEXT,
          DISCORD_LOGS_LIMITS.FOOTER,
        ),
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async dispatchToDiscord(webhookUrl: string, body: any) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 429) {
        const retryInfo = await response.json().catch(() => ({}));
        const retryAfter = retryInfo?.retry_after;
        this.logger.warn(
          `[DiscordLogs] Rate limit do Discord. retry_after=${retryAfter ?? 'n/a'}`,
        );
        return;
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        this.logger.warn(
          `[DiscordLogs] Falha ao enviar webhook. status=${response.status} body=${sanitizeDiscordText(errorBody, 500)}`,
        );
      }
    } catch (error: any) {
      const reason = this.normalizeValue(error?.message) || 'erro_desconhecido';
      this.logger.warn(`[DiscordLogs] Erro de envio: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveWebhookUrl(
    channelType: DiscordLogChannelType,
    category?: DiscordLogCategory,
  ) {
    const specificEnvKey = DISCORD_LOG_CHANNEL_ENV_KEYS[channelType];
    const defaultEnvKey = DISCORD_LOG_CHANNEL_ENV_KEYS[DiscordLogChannelType.DEFAULT];

    const specificUrl = this.normalizeWebhookUrl(process.env[specificEnvKey]);
    const defaultUrl = this.normalizeWebhookUrl(process.env[defaultEnvKey]);

    if (specificUrl) return specificUrl;
    if (defaultUrl) return defaultUrl;

    if (category) {
      const fallbackChannel = DISCORD_LOG_CATEGORY_DEFAULT_CHANNEL[category];
      if (fallbackChannel && fallbackChannel !== channelType) {
        const fallbackEnvKey = DISCORD_LOG_CHANNEL_ENV_KEYS[fallbackChannel];
        const fallbackUrl = this.normalizeWebhookUrl(process.env[fallbackEnvKey]);
        if (fallbackUrl) return fallbackUrl;
      }
    }

    return null;
  }

  private mapChannelToCategory(channelType: DiscordLogChannelType): DiscordLogCategory {
    switch (channelType) {
      case DiscordLogChannelType.ERRORS:
        return DiscordLogCategory.ERROR;
      case DiscordLogChannelType.PAYMENTS:
        return DiscordLogCategory.PAYMENT;
      case DiscordLogChannelType.AUTH:
        return DiscordLogCategory.AUTH;
      case DiscordLogChannelType.RAFFLES:
        return DiscordLogCategory.RAFFLE;
      case DiscordLogChannelType.ADMIN:
        return DiscordLogCategory.ADMIN;
      case DiscordLogChannelType.SYSTEM:
        return DiscordLogCategory.SYSTEM;
      case DiscordLogChannelType.WEBHOOK:
        return DiscordLogCategory.WEBHOOK;
      default:
        return DiscordLogCategory.INFO;
    }
  }

  private normalizeWebhookUrl(value: string | undefined) {
    const normalized = this.normalizeValue(value);
    if (!normalized) return null;
    if (!normalized.startsWith('https://')) return null;
    return normalized;
  }

  private normalizeValue(value: unknown) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized;
  }
}
