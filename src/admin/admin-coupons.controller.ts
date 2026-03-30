import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminCouponsService } from './admin-coupons.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly adminCouponsService: AdminCouponsService) {}

  @Get()
  async listCoupons(
    @Query('search') search?: string,
    @Query('active') active?: string,
  ) {
    return this.adminCouponsService.listCoupons({ search, active });
  }

  @Post()
  async createCoupon(
    @Body()
    body: {
      code?: string;
      type?: string;
      value?: number;
      active?: boolean;
      usageLimit?: number | null;
      expiresAt?: string | null;
    },
  ) {
    return this.adminCouponsService.createCoupon(body);
  }

  @Patch(':id')
  async updateCoupon(
    @Param('id') id: string,
    @Body()
    body: {
      code?: string;
      type?: string;
      value?: number;
      active?: boolean;
      usageLimit?: number | null;
      expiresAt?: string | null;
    },
  ) {
    return this.adminCouponsService.updateCoupon(id, body);
  }

  @Patch(':id/active')
  async setCouponActive(
    @Param('id') id: string,
    @Body() body: { active?: boolean },
  ) {
    return this.adminCouponsService.setCouponActive(id, !!body?.active);
  }
}

