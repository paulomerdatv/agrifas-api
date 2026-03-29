import { Controller, Post, Body, UseGuards, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('payments/infinitepay')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-checkout')
  @HttpCode(HttpStatus.OK)
  async createCheckout(
    @Body() body: { raffleId: string; selectedTickets: number[] },
    @CurrentUser() jwtUser: any
  ) {
    return this.paymentsService.createInfinitePayCheckout(
      jwtUser, 
      body.raffleId, 
      body.selectedTickets
    );
  }

  @Get('check/:orderNsu')
  async checkPaymentStatus(@Param('orderNsu') orderNsu: string) {
    return this.paymentsService.checkPaymentStatus(orderNsu);
  }
}