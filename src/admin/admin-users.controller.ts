import {
  Controller,
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
import { AdminUsersService } from './admin-users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  async listUsers(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminUsersService.listUsers({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  async getUserDetail(@Param('id') id: string) {
    return this.adminUsersService.getUserDetail(id);
  }

  @Patch(':id/promote')
  async promoteToAdmin(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.adminUsersService.promoteToAdmin(id, user?.userId);
  }

  @Patch(':id/remove-admin')
  async removeAdmin(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.adminUsersService.removeAdmin(id, user?.userId);
  }

  @Patch(':id/block')
  async blockUser(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.adminUsersService.blockUser(id, user?.userId);
  }

  @Patch(':id/unblock')
  async unblockUser(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.adminUsersService.unblockUser(id, user?.userId);
  }
}
