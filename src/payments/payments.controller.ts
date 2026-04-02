import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-checkout')
  @UseGuards(RateLimitGuard)
  @RateLimit({
    limit: Number(process.env.ANTI_FRAUD_RATE_LIMIT_CHECKOUT_PER_MINUTE || 6),
    windowMs: 60_000,
    keyPrefix: 'payments:create-checkout',
  })
  @HttpCode(HttpStatus.OK)
  async createCheckout(
    @Body()
    body: {
      raffleId: string;
      selectedTickets: number[];
      couponCode?: string;
      origin?: {
        ref?: string;
        utm_source?: string;
        utm_medium?: string;
        utm_campaign?: string;
      };
      customerData?: {
        fullName?: string;
        email?: string;
        whatsapp?: string;
        tradeLink?: string;
        cpfCnpj?: string;
      };
    },
    @CurrentUser() jwtUser: any,
    @Req() req: any,
  ) {
    return this.paymentsService.createAsaasCheckout(jwtUser, body, {
      ipAddress: this.extractIpAddress(req),
      route: 'POST /payments/create-checkout',
    });
  }

  @Post('validate-coupon')
  @UseGuards(RateLimitGuard)
  @RateLimit({
    limit: Number(process.env.ANTI_FRAUD_RATE_LIMIT_VALIDATE_COUPON_PER_MINUTE || 20),
    windowMs: 60_000,
    keyPrefix: 'payments:validate-coupon',
  })
  @HttpCode(HttpStatus.OK)
  async validateCoupon(
    @Body()
    body: {
      raffleId: string;
      selectedTickets: number[];
      couponCode: string;
    },
    @CurrentUser() jwtUser: any,
  ) {
    return this.paymentsService.validateCouponForCheckout(jwtUser, body);
  }

  @Get('check/:orderNsu')
  @UseGuards(RateLimitGuard)
  @RateLimit({
    limit: Number(process.env.ANTI_FRAUD_RATE_LIMIT_CHECK_STATUS_PER_MINUTE || 90),
    windowMs: 60_000,
    keyPrefix: 'payments:check-status',
  })
  async checkPaymentStatus(@Param('orderNsu') orderNsu: string) {
    return this.paymentsService.checkPaymentStatus(orderNsu);
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
