import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('infinitepay/create-checkout')
  @UseGuards(JwtAuthGuard)
  createCheckout(
    @CurrentUser() user: any,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.paymentsService.createInfinitePayCheckout(user, dto);
  }

  @Get('infinitepay/check/:orderNsu')
  @UseGuards(JwtAuthGuard)
  checkOrder(@Param('orderNsu') orderNsu: string) {
    return this.paymentsService.checkOrderStatus(orderNsu);
  }
}