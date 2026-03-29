import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('raffles')
export class RafflesController {
  constructor(private readonly prisma: PrismaService) {}

  private formatRaffleWithTickets(raffle: any) {
    const paidOrders =
      raffle.orders?.filter((o: any) => o.status === 'PAID') || [];

    const reservedOrders =
      raffle.orders?.filter((o: any) => {
        if (o.status !== 'PENDING') return false;

        if (o.provider === 'ADMIN_RESERVE') return true;

        const createdAt = new Date(o.createdAt).getTime();
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        return createdAt >= tenMinutesAgo;
      }) || [];

    const soldNumbers: number[] = paidOrders.flatMap((o: any) => o.selectedTickets);
    const reservedNumbers: number[] = reservedOrders.flatMap((o: any) => o.selectedTickets);

    const tickets = Array.from({ length: raffle.totalTickets }, (_, i) => {
      const number = i + 1;
      let status = 'available';

      if (soldNumbers.includes(number)) {
        status = 'sold';
      } else if (reservedNumbers.includes(number)) {
        status = 'reserved';
      }

      return { number, status };
    });

    return {
      ...raffle,
      tickets,
      soldTickets: [...soldNumbers, ...reservedNumbers],
      soldCount: soldNumbers.length,
      reservedCount: reservedNumbers.length,
    };
  }

  @Get()
  async findAll() {
    const raffles = await this.prisma.raffle.findMany({
      where: {
        status: { in: ['ACTIVE'] },
      },
      include: {
        orders: {
          select: {
            selectedTickets: true,
            status: true,
            provider: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return raffles.map((r) => this.formatRaffleWithTickets(r));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id },
      include: {
        orders: {
          select: {
            selectedTickets: true,
            status: true,
            provider: true,
            createdAt: true,
          },
        },
      },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    return this.formatRaffleWithTickets(raffle);
  }
}