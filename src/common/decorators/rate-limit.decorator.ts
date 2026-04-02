import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_OPTIONS_KEY = 'rate_limit_options_key';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyPrefix?: string;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_OPTIONS_KEY, options);

