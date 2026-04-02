import { Injectable, Logger } from '@nestjs/common';
import { DiscordLogsService } from '../../discord-logs/discord-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

interface SecurityEventInput {
  eventType: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  userId?: string | null;
  ipAddress?: string | null;
  route?: string | null;
  context?: Record<string, any> | null;
}

@Injectable()
export class SecurityMonitorService {
  private readonly logger = new Logger(SecurityMonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogsService: DiscordLogsService,
  ) {}

  async logSuspiciousAttempt(input: SecurityEventInput) {
    const severity = input.severity || 'WARNING';
    const eventType = this.normalizeValue(input.eventType) || 'UNKNOWN_SECURITY_EVENT';
    const userId = this.normalizeValue(input.userId);
    const ipAddress = this.normalizeValue(input.ipAddress);
    const route = this.normalizeValue(input.route);
    const context = this.sanitizeContext(input.context);

    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType,
          severity,
          userId: userId || null,
          ipAddress: ipAddress || null,
          route: route || null,
          context: context || undefined,
        },
      });
    } catch (error: any) {
      this.logger.warn(
        `Falha ao registrar SecurityEvent no banco: ${error?.message || 'erro_desconhecido'}`,
      );
    }

    void this.discordLogsService.sendWarningLog({
      title: 'Tentativa suspeita detectada',
      description: 'Uma regra antifraude/antiabuso foi acionada.',
      fields: [
        { name: 'eventType', value: eventType, inline: true },
        { name: 'severity', value: severity, inline: true },
        { name: 'userId', value: userId || '-', inline: true },
        { name: 'ip', value: ipAddress || '-', inline: true },
        { name: 'route', value: route || '-', inline: false },
        {
          name: 'context',
          value: context ? JSON.stringify(context).slice(0, 350) : '-',
          inline: false,
        },
      ],
    });
  }

  private sanitizeContext(context?: Record<string, any> | null) {
    if (!context || typeof context !== 'object') return null;
    const safe: Record<string, any> = {};

    for (const [key, value] of Object.entries(context)) {
      if (value === null || value === undefined) continue;
      const normalizedKey = this.normalizeValue(key);
      if (!normalizedKey) continue;

      if (typeof value === 'number' || typeof value === 'boolean') {
        safe[normalizedKey] = value;
        continue;
      }

      const normalizedValue = this.normalizeValue(value);
      if (!normalizedValue) continue;

      if (
        normalizedKey.toLowerCase().includes('token') ||
        normalizedKey.toLowerCase().includes('secret') ||
        normalizedKey.toLowerCase().includes('password')
      ) {
        safe[normalizedKey] = '[REDACTED]';
        continue;
      }

      safe[normalizedKey] = normalizedValue.slice(0, 200);
    }

    return Object.keys(safe).length ? safe : null;
  }

  private normalizeValue(value: unknown) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized;
  }
}

