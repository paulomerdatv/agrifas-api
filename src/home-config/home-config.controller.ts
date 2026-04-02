import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { HomeConfigService } from './home-config.service';

@Controller()
export class HomeConfigController {
  constructor(private readonly homeConfigService: HomeConfigService) {}

  @Get('public/home-config')
  async getPublicConfig() {
    return this.homeConfigService.getPublicConfig();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/home-config')
  async getAdminConfig() {
    return this.homeConfigService.getAdminConfig();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/home-config')
  async updateAdminConfig(@Body() body: any) {
    return this.homeConfigService.updateConfig(body || {});
  }
}
