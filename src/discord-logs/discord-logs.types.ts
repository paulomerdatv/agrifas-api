export enum DiscordLogChannelType {
  DEFAULT = 'DEFAULT',
  ERRORS = 'ERRORS',
  PAYMENTS = 'PAYMENTS',
  AUTH = 'AUTH',
  RAFFLES = 'RAFFLES',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
  WEBHOOK = 'WEBHOOK',
}

export enum DiscordLogCategory {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  PAYMENT = 'PAYMENT',
  AUTH = 'AUTH',
  RAFFLE = 'RAFFLE',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
  WEBHOOK = 'WEBHOOK',
}

export interface DiscordLogFieldInput {
  name: string;
  value: unknown;
  inline?: boolean;
}

export interface DiscordLogPayloadInput {
  title: string;
  description?: unknown;
  category?: DiscordLogCategory;
  color?: number;
  fields?: DiscordLogFieldInput[];
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedPayload {
  title: string;
  description?: string;
  color: number;
  fields: DiscordEmbedField[];
  footer: { text: string };
  timestamp: string;
}
