import { Global, Module } from '@nestjs/common';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { SecurityMonitorService } from './security-monitor.service';

@Global()
@Module({
  providers: [SecurityMonitorService, RateLimitGuard],
  exports: [SecurityMonitorService, RateLimitGuard],
})
export class SecurityModule {}

