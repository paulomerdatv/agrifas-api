import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CampaignsService } from './campaigns.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/campaigns')
export class AdminCampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  async listCampaigns() {
    return this.campaignsService.listAdminCampaigns();
  }

  @Get(':id')
  async getCampaign(@Param('id') id: string) {
    return this.campaignsService.getAdminCampaignById(id);
  }

  @Post()
  async createCampaign(@Body() body: any, @CurrentUser() user: any) {
    return this.campaignsService.createCampaign(body || {}, user?.userId);
  }

  @Patch(':id')
  async updateCampaign(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.updateCampaign(id, body || {}, user?.userId);
  }

  @Delete(':id')
  async deleteCampaign(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.deleteCampaign(id, user?.userId);
  }
}

