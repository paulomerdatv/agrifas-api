import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('raffles')
export class RafflesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.raffle.findMany({
      where: { 
        status: { in: ['ACTIVE'] } 
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id },
      include: {
        orders: {
          select: { selectedTickets: true }
        }
      }
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    return raffle;
  }
}