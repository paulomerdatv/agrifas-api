import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrdersService } from './admin-orders.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  @Get('metrics')
  async getMetrics() {
    return this.adminOrdersService.getOrderMetrics();
  }

  @Get()
  async listOrders(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminOrdersService.listOrders({
      status,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  async getOrderDetail(@Param('id') id: string) {
    return this.adminOrdersService.getOrderById(id);
  }

  @Patch(':id/confirm-payment')
  async confirmPaymentManually(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.adminOrdersService.confirmPaymentManually(id, user?.userId);
  }

  @Patch(':id/cancel')
  async cancelOrder(@Param('id') id: string) {
    return this.adminOrdersService.cancelOrder(id);
  }

  @Patch(':id/reprocess')
  async reprocessOrderStatus(@Param('id') id: string) {
    return this.adminOrdersService.reprocessOrderStatus(id);
  }

  @Delete(':id/customer-data')
  async deleteCustomerData(@Param('id') id: string) {
    return this.adminOrdersService.deleteCustomerData(id);
  }
}
