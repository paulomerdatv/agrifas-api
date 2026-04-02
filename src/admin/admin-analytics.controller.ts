import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrdersService } from './admin-orders.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  @Get('overview')
  async getOverview() {
    return this.adminOrdersService.getAnalyticsOverview();
  }

  @Get('revenue-series')
  async getRevenueSeries(@Query('days') days?: string) {
    return this.adminOrdersService.getAnalyticsRevenueSeries(
      days ? Number(days) : undefined,
    );
  }

  @Get('top-raffles')
  async getTopRaffles() {
    return this.adminOrdersService.getAnalyticsTopRaffles();
  }
}

