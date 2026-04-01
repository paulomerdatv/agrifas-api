import { DiscordLogCategory, DiscordLogChannelType } from './discord-logs.types';

export const DISCORD_LOGS_DEFAULT_TIMEOUT_MS = 5000;

export const DISCORD_LOGS_LIMITS = {
  TITLE: 256,
  DESCRIPTION: 4096,
  FIELD_NAME: 256,
  FIELD_VALUE: 1024,
  FIELDS_MAX: 25,
  FOOTER: 2048,
} as const;

export const DISCORD_LOGS_FOOTER_TEXT = 'AGrifas • Logs';

export const DISCORD_LOG_CATEGORY_COLORS: Record<DiscordLogCategory, number> = {
  [DiscordLogCategory.INFO]: 0x3b82f6,
  [DiscordLogCategory.SUCCESS]: 0x22c55e,
  [DiscordLogCategory.WARNING]: 0xfacc15,
  [DiscordLogCategory.ERROR]: 0xef4444,
  [DiscordLogCategory.PAYMENT]: 0x1f7a3f,
  [DiscordLogCategory.AUTH]: 0x06b6d4,
  [DiscordLogCategory.RAFFLE]: 0x8b5cf6,
  [DiscordLogCategory.ADMIN]: 0xf97316,
  [DiscordLogCategory.SYSTEM]: 0x6b7280,
  [DiscordLogCategory.WEBHOOK]: 0xbe185d,
};

export const DISCORD_LOG_CHANNEL_ENV_KEYS: Record<DiscordLogChannelType, string> = {
  [DiscordLogChannelType.DEFAULT]: 'DISCORD_LOGS_DEFAULT_WEBHOOK_URL',
  [DiscordLogChannelType.ERRORS]: 'DISCORD_LOGS_ERRORS_WEBHOOK_URL',
  [DiscordLogChannelType.PAYMENTS]: 'DISCORD_LOGS_PAYMENTS_WEBHOOK_URL',
  [DiscordLogChannelType.AUTH]: 'DISCORD_LOGS_AUTH_WEBHOOK_URL',
  [DiscordLogChannelType.RAFFLES]: 'DISCORD_LOGS_RAFFLES_WEBHOOK_URL',
  [DiscordLogChannelType.ADMIN]: 'DISCORD_LOGS_ADMIN_WEBHOOK_URL',
  [DiscordLogChannelType.SYSTEM]: 'DISCORD_LOGS_SYSTEM_WEBHOOK_URL',
  [DiscordLogChannelType.WEBHOOK]: 'DISCORD_LOGS_WEBHOOKS_WEBHOOK_URL',
};

export const DISCORD_LOG_CATEGORY_DEFAULT_CHANNEL: Record<
  DiscordLogCategory,
  DiscordLogChannelType
> = {
  [DiscordLogCategory.INFO]: DiscordLogChannelType.DEFAULT,
  [DiscordLogCategory.SUCCESS]: DiscordLogChannelType.DEFAULT,
  [DiscordLogCategory.WARNING]: DiscordLogChannelType.DEFAULT,
  [DiscordLogCategory.ERROR]: DiscordLogChannelType.ERRORS,
  [DiscordLogCategory.PAYMENT]: DiscordLogChannelType.PAYMENTS,
  [DiscordLogCategory.AUTH]: DiscordLogChannelType.AUTH,
  [DiscordLogCategory.RAFFLE]: DiscordLogChannelType.RAFFLES,
  [DiscordLogCategory.ADMIN]: DiscordLogChannelType.ADMIN,
  [DiscordLogCategory.SYSTEM]: DiscordLogChannelType.SYSTEM,
  [DiscordLogCategory.WEBHOOK]: DiscordLogChannelType.WEBHOOK,
};
