import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: any) {
    return this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        role: true, 
        createdAt: true, 
        updatedAt: true 
      }
    });
  }
}