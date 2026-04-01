import {
  DiscordLogCategory,
  DiscordLogFieldInput,
} from './discord-logs.types';
import { DISCORD_LOGS_LIMITS } from './discord-logs.constants';

export function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export function parseNumberEnv(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
}

export function parseDiscordLogCategory(
  value: string | undefined | null,
): DiscordLogCategory | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  const categories = Object.values(DiscordLogCategory);
  return categories.includes(normalized as DiscordLogCategory)
    ? (normalized as DiscordLogCategory)
    : null;
}

export function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

export function sanitizeDiscordText(
  input: unknown,
  maxLength: number,
): string {
  const raw = String(input ?? '')
    .replace(/\u0000/g, '')
    .replace(/```/g, "'''")
    .replace(/<@/g, '<@\u200b')
    .replace(/<#/g, '<#\u200b')
    .replace(/@/g, '@\u200b')
    .trim();

  if (!raw) return '-';
  return truncateText(raw, maxLength);
}

export function safeFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sanitizeDiscordFields(fields?: DiscordLogFieldInput[]) {
  const safeFields = Array.isArray(fields) ? fields : [];

  return safeFields
    .slice(0, DISCORD_LOGS_LIMITS.FIELDS_MAX)
    .map((field) => ({
      name: sanitizeDiscordText(field.name, DISCORD_LOGS_LIMITS.FIELD_NAME),
      value: sanitizeDiscordText(
        safeFieldValue(field.value),
        DISCORD_LOGS_LIMITS.FIELD_VALUE,
      ),
      inline: Boolean(field.inline),
    }));
}
