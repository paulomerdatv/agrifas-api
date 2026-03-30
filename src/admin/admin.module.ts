import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

@Module({
  controllers: [AdminController, AdminOperationsController, AdminOrdersController],
  providers: [AdminOrdersService],
})
export class AdminModule {}
