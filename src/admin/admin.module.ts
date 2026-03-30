import { Module } from '@nestjs/common';
import { AdminCouponsController } from './admin-coupons.controller';
import { AdminCouponsService } from './admin-coupons.service';
import { AdminController } from './admin.controller';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  controllers: [
    AdminController,
    AdminCouponsController,
    AdminOperationsController,
    AdminOrdersController,
    AdminUsersController,
  ],
  providers: [AdminOrdersService, AdminUsersService, AdminCouponsService],
})
export class AdminModule {}
