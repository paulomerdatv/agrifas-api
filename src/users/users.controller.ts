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
        steamId: true,
        steamAvatar: true,
        provider: true,
        twoFactorEnabled: true,
        twoFactorMethod: true,
        twoFactorEmailVerifiedAt: true,
        role: true,
        isBlocked: true,
        blockedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  @Get('me/account-overview')
  async getAccountOverview(@CurrentUser() user: any) {
    const [account, orders, wins] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          provider: true,
          steamId: true,
          steamAvatar: true,
          twoFactorEnabled: true,
          twoFactorMethod: true,
          twoFactorEmailVerifiedAt: true,
          isBlocked: true,
          blockedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.order.findMany({
        where: { userId: user.userId },
        include: {
          raffle: {
            select: {
              id: true,
              title: true,
              image: true,
              status: true,
              pricePerTicket: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.winner.findMany({
        where: { userId: user.userId },
        include: {
          raffle: {
            select: {
              id: true,
              title: true,
              image: true,
              status: true,
              estimatedValue: true,
            },
          },
          order: {
            select: {
              id: true,
              orderNsu: true,
              selectedTickets: true,
              totalAmount: true,
              status: true,
            },
          },
        },
        orderBy: { drawnAt: 'desc' },
      }),
    ]);

    const activeOrderStatuses = new Set(['PENDING', 'WAITING_PAYMENT']);
    const participationMap = new Map<
      string,
      {
        raffleId: string;
        raffleTitle: string;
        raffleImage: string | null;
        raffleStatus: string;
        totalOrders: number;
        totalTickets: number;
        paidTickets: number;
        activeTickets: number;
        totalSpent: number;
        lastOrderAt: Date;
      }
    >();

    let totalSpent = 0;
    let activeTickets = 0;

    for (const order of orders) {
      const isPaid = order.status === 'PAID';
      const isActive = activeOrderStatuses.has(order.status);
      const ticketsCount = Array.isArray(order.selectedTickets)
        ? order.selectedTickets.length
        : 0;

      if (isPaid) {
        totalSpent += order.totalAmount || 0;
      }

      if (isActive) {
        activeTickets += ticketsCount;
      }

      if (!order.raffle) continue;

      const existing = participationMap.get(order.raffleId);
      if (!existing) {
        participationMap.set(order.raffleId, {
          raffleId: order.raffleId,
          raffleTitle: order.raffle.title,
          raffleImage: order.raffle.image || null,
          raffleStatus: order.raffle.status,
          totalOrders: 1,
          totalTickets: ticketsCount,
          paidTickets: isPaid ? ticketsCount : 0,
          activeTickets: isActive ? ticketsCount : 0,
          totalSpent: isPaid ? order.totalAmount || 0 : 0,
          lastOrderAt: order.createdAt,
        });
      } else {
        existing.totalOrders += 1;
        existing.totalTickets += ticketsCount;
        existing.paidTickets += isPaid ? ticketsCount : 0;
        existing.activeTickets += isActive ? ticketsCount : 0;
        existing.totalSpent += isPaid ? order.totalAmount || 0 : 0;
        if (order.createdAt > existing.lastOrderAt) {
          existing.lastOrderAt = order.createdAt;
        }
        participationMap.set(order.raffleId, existing);
      }
    }

    const participations = Array.from(participationMap.values()).sort(
      (a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime(),
    );

    const deliveredWins = wins.filter(
      (winner) => winner.deliveryStatus === 'DELIVERED',
    ).length;
    const pendingDeliveries = wins.filter(
      (winner) =>
        winner.deliveryStatus !== 'DELIVERED' &&
        winner.deliveryStatus !== 'CANCELLED',
    ).length;

    return {
      summary: {
        totalOrders: orders.length,
        participatedRaffles: participations.length,
        activeTickets,
        totalSpent,
        winsCount: wins.length,
        deliveredWins,
        pendingDeliveries,
      },
      orders,
      participations,
      wins,
      account,
    };
  }
}
