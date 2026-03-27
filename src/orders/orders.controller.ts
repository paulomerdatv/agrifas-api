import { Controller, Post, Get, Body, UseGuards, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async createOrder(
    @Body() body: { raffleId: string; selectedTickets: number[] }, 
    @CurrentUser() user: any
  ) {
    const { raffleId, selectedTickets } = body;
    
    const raffle = await this.prisma.raffle.findUnique({ 
      where: { id: raffleId }
    });
    
    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    const totalAmount = selectedTickets.length * raffle.pricePerTicket;

    return this.prisma.order.create({
      data: {
        userId: user.userId,
        raffleId,
        selectedTickets,
        totalAmount,
        status: 'PENDING'
      }
    });
  }

  @Get('me')
  async getMyOrders(@CurrentUser() user: any) {
    return this.prisma.order.findMany({
      where: { userId: user.userId },
      include: { 
        raffle: {
          select: { title: true, image: true, pricePerTicket: true }
        } 
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}