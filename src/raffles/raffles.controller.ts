import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('raffles')
export class RafflesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    const raffles = await this.prisma.raffle.findMany({
      where: {
        status: {
          in: ['ACTIVE'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        orders: {
          where: {
            status: {
              in: ['PAID', 'PENDING'],
            },
          },
          select: {
            selectedTickets: true,
            status: true,
          },
        },
      },
    });

    return raffles.map((raffle) => {
      const tickets = Array.from({ length: raffle.totalTickets }, (_, i) => {
        const ticketNumber = i + 1;

        let status: 'available' | 'reserved' | 'sold' = 'available';

        const paidOrder = raffle.orders.find(
          (order) =>
            order.status === 'PAID' &&
            order.selectedTickets.includes(ticketNumber),
        );

        const pendingOrder = raffle.orders.find(
          (order) =>
            order.status === 'PENDING' &&
            order.selectedTickets.includes(ticketNumber),
        );

        if (paidOrder) {
          status = 'sold';
        } else if (pendingOrder) {
          status = 'reserved';
        }

        return {
          number: ticketNumber,
          status,
        };
      });

      const soldTickets = tickets
        .filter((t) => t.status === 'sold' || t.status === 'reserved')
        .map((t) => t.number);

      return {
        ...raffle,
        tickets,
        soldTickets,
      };
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id },
      include: {
        orders: {
          where: {
            status: {
              in: ['PAID', 'PENDING'],
            },
          },
          select: {
            selectedTickets: true,
            status: true,
          },
        },
      },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    const tickets = Array.from({ length: raffle.totalTickets }, (_, i) => {
      const ticketNumber = i + 1;

      let status: 'available' | 'reserved' | 'sold' = 'available';

      const paidOrder = raffle.orders.find(
        (order) =>
          order.status === 'PAID' &&
          order.selectedTickets.includes(ticketNumber),
      );

      const pendingOrder = raffle.orders.find(
        (order) =>
          order.status === 'PENDING' &&
          order.selectedTickets.includes(ticketNumber),
      );

      if (paidOrder) {
        status = 'sold';
      } else if (pendingOrder) {
        status = 'reserved';
      }

      return {
        number: ticketNumber,
        status,
      };
    });

    const soldTickets = tickets
      .filter((t) => t.status === 'sold' || t.status === 'reserved')
      .map((t) => t.number);

    return {
      ...raffle,
      tickets,
      soldTickets,
    };
  }
}