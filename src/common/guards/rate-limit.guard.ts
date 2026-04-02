import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RATE_LIMIT_OPTIONS_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { SecurityMonitorService } from '../security/security-monitor.service';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly buckets = new Map<string, RateLimitBucket>();

  constructor(private readonly securityMonitorService: SecurityMonitorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const handler = context.getHandler();
    const classRef = context.getClass();

    const options: RateLimitOptions | undefined =
      Reflect.getMetadata(RATE_LIMIT_OPTIONS_KEY, handler) ||
      Reflect.getMetadata(RATE_LIMIT_OPTIONS_KEY, classRef);

    if (!options?.limit || !options?.windowMs) {
      return true;
    }

    const now = Date.now();
    const ipAddress = this.extractIpAddress(request);
    const userId = request?.user?.userId || request?.user?.sub || null;
    const route = `${request?.method || 'HTTP'} ${
      request?.baseUrl || ''
    }${request?.route?.path || request?.path || ''}`.trim();
    const keyPrefix = options.keyPrefix || route;
    const key = `${keyPrefix}:${userId || 'anon'}:${ipAddress || 'unknown'}`;

    let bucket = RateLimitGuard.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + options.windowMs,
      };
    }

    bucket.count += 1;
    RateLimitGuard.buckets.set(key, bucket);

    if (Math.random() < 0.01) {
      this.cleanupExpiredBuckets(now);
    }

    if (bucket.count <= options.limit) {
      return true;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    await this.securityMonitorService.logSuspiciousAttempt({
      eventType: 'RATE_LIMIT_EXCEEDED',
      severity: 'WARNING',
      userId,
      ipAddress,
      route,
      context: {
        keyPrefix,
        limit: options.limit,
        windowMs: options.windowMs,
        retryAfterSeconds,
      },
    });

    throw new HttpException(
      `Muitas tentativas em pouco tempo. Aguarde ${retryAfterSeconds}s e tente novamente.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private cleanupExpiredBuckets(now: number) {
    for (const [key, bucket] of RateLimitGuard.buckets.entries()) {
      if (bucket.resetAt <= now) {
        RateLimitGuard.buckets.delete(key);
      }
    }
  }

  private extractIpAddress(request: any) {
    const forwardedFor = request?.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }

    if (Array.isArray(forwardedFor) && forwardedFor.length) {
      return String(forwardedFor[0]).trim();
    }

    return (
      request?.ip ||
      request?.socket?.remoteAddress ||
      request?.connection?.remoteAddress ||
      null
    );
  }
}
