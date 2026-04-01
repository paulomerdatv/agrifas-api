import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('winners')
export class WinnersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findLatest() {
    return this.prisma.winner.findMany({
      include: {
        raffle: {
          select: {
            id: true,
            title: true,
            image: true,
            estimatedValue: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNsu: true,
            selectedTickets: true,
            totalAmount: true,
          },
        },
      },
      orderBy: { drawnAt: 'desc' },
      take: 30,
    });
  }
}

