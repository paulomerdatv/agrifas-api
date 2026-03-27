import { Controller, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, RaffleStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/raffles')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async createRaffle(@Body() data: any) {
    return this.prisma.raffle.create({ 
      data: {
        title: data.title,
        description: data.description,
        image: data.image,
        pricePerTicket: data.pricePerTicket,
        totalTickets: data.totalTickets,
        estimatedValue: data.estimatedValue,
        status: data.status || RaffleStatus.DRAFT,
      } 
    });
  }

  @Patch(':id')
  async updateRaffle(@Param('id') id: string, @Body() data: any) {
    return this.prisma.raffle.update({ 
      where: { id }, 
      data 
    });
  }

  @Patch(':id/publish')
  async publishRaffle(@Param('id') id: string) {
    return this.prisma.raffle.update({ 
      where: { id }, 
      data: { status: RaffleStatus.ACTIVE }
    });
  }

  @Patch(':id/pause')
  async pauseRaffle(@Param('id') id: string) {
    return this.prisma.raffle.update({ 
      where: { id }, 
      data: { status: RaffleStatus.PAUSED }
    });
  }
  
  @Patch(':id/cancel')
  async cancelRaffle(@Param('id') id: string) {
    return this.prisma.raffle.update({ 
      where: { id }, 
      data: { status: RaffleStatus.CANCELLED }
    });
  }
}