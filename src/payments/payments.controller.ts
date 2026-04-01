import { Controller, Post, Body, UseGuards, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-checkout')
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
  ) {
    return this.paymentsService.createAsaasCheckout(jwtUser, body);
  }

  @Post('validate-coupon')
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
  async checkPaymentStatus(@Param('orderNsu') orderNsu: string) {
    return this.paymentsService.checkPaymentStatus(orderNsu);
  }
}
