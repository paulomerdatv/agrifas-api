import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminOperationsController } from './admin-operations.controller';

@Module({
  controllers: [AdminController, AdminOperationsController],
})
export class AdminModule {}
