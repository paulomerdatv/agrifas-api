import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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
      },
    });
  }

  @Patch(':id')
  async updateRaffle(@Param('id') id: string, @Body() data: any) {
    return this.prisma.raffle.update({
      where: { id },
      data,
    });
  }

  @Patch(':id/publish')
  async publishRaffle(@Param('id') id: string) {
    return this.prisma.raffle.update({
      where: { id },
      data: { status: RaffleStatus.ACTIVE },
    });
  }

  @Patch(':id/pause')
  async pauseRaffle(@Param('id') id: string) {
    return this.prisma.raffle.update({
      where: { id },
      data: { status: RaffleStatus.PAUSED },
    });
  }

  @Patch(':id/cancel')
  async cancelRaffle(@Param('id') id: string) {
    return this.prisma.raffle.update({
      where: { id },
      data: { status: RaffleStatus.CANCELLED },
    });
  }

  @Delete(':id')
  async deleteRaffle(@Param('id') id: string) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    await this.prisma.$transaction([
      this.prisma.order.deleteMany({
        where: { raffleId: id },
      }),
      this.prisma.raffle.delete({
        where: { id },
      }),
    ]);

    return { success: true, message: 'Rifa removida com sucesso.' };
  }

  @Post(':id/reserve')
  async reserveTickets(
    @Param('id') raffleId: string,
    @Body()
    body: {
      userId: string;
      selectedTickets: number[];
    },
    @CurrentUser() adminUser: any,
  ) {
    const { userId, selectedTickets } = body;

    if (!userId) {
      throw new BadRequestException('userId é obrigatório.');
    }

    if (!selectedTickets || !Array.isArray(selectedTickets) || selectedTickets.length === 0) {
      throw new BadRequestException('Selecione ao menos uma cota.');
    }

    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
      include: {
        orders: {
          where: {
            OR: [
              { status: 'PAID' },
              { status: 'PENDING', provider: 'ADMIN_RESERVE' },
              {
                status: 'PENDING',
                createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
              },
            ],
          },
          select: {
            selectedTickets: true,
            status: true,
            provider: true,
          },
        },
      },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuário alvo não encontrado.');
    }

    const occupiedTickets = raffle.orders.flatMap((o) => o.selectedTickets);
    const conflict = selectedTickets.some((ticket) => occupiedTickets.includes(ticket));

    if (conflict) {
      throw new BadRequestException('Uma ou mais cotas já estão reservadas ou vendidas.');
    }

    const totalAmount = selectedTickets.length * raffle.pricePerTicket;
    const orderNsu = `ADMIN-RESERVE-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    const order = await this.prisma.order.create({
      data: {
        userId,
        raffleId,
        selectedTickets,
        totalAmount,
        status: 'PENDING',
        provider: 'ADMIN_RESERVE',
        orderNsu,
      },
    });

    return {
      success: true,
      message: `Reserva manual criada para ${targetUser.name}.`,
      order,
      reservedByAdminId: adminUser?.userId,
    };
  }

  @Post(':id/unreserve')
  async unreserveTickets(
    @Param('id') raffleId: string,
    @Body()
    body: {
      userId?: string;
      selectedTickets: number[];
    },
  ) {
    const { userId, selectedTickets } = body;

    if (!selectedTickets || !Array.isArray(selectedTickets) || selectedTickets.length === 0) {
      throw new BadRequestException('Informe as cotas a liberar.');
    }

    const pendingAdminReserves = await this.prisma.order.findMany({
      where: {
        raffleId,
        status: 'PENDING',
        provider: 'ADMIN_RESERVE',
        ...(userId ? { userId } : {}),
      },
      select: {
        id: true,
        selectedTickets: true,
      },
    });

    const orderIdsToCancel = pendingAdminReserves
      .filter((order) =>
        order.selectedTickets.some((ticket) => selectedTickets.includes(ticket)),
      )
      .map((order) => order.id);

    if (orderIdsToCancel.length === 0) {
      throw new NotFoundException('Nenhuma reserva manual encontrada para essas cotas.');
    }

    await this.prisma.order.updateMany({
      where: {
        id: { in: orderIdsToCancel },
      },
      data: {
        status: 'CANCELLED',
      },
    });

    return {
      success: true,
      message: 'Reserva manual removida com sucesso.',
      affectedOrders: orderIdsToCancel.length,
    };
  }

  @Post(':id/draw-winner')
  async drawWinner(
    @Param('id') raffleId: string,
    @CurrentUser() adminUser: any,
  ) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
      include: {
        winner: {
          select: { id: true },
        },
        orders: {
          where: { status: 'PAID' },
          select: {
            id: true,
            userId: true,
            selectedTickets: true,
          },
        },
      },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa nao encontrada.');
    }

    if (raffle.winner) {
      throw new BadRequestException('Esta rifa ja possui vencedor.');
    }

    const ticketPool = raffle.orders.flatMap((order) =>
      order.selectedTickets.map((ticketNumber) => ({
        ticketNumber,
        orderId: order.id,
        userId: order.userId,
      })),
    );

    if (!ticketPool.length) {
      throw new BadRequestException('Nao ha cotas pagas para sortear.');
    }

    const drawnIndex = Math.floor(Math.random() * ticketPool.length);
    const drawnTicket = ticketPool[drawnIndex];

    const winner = await this.prisma.$transaction(async (tx) => {
      const createdWinner = await tx.winner.create({
        data: {
          raffleId,
          orderId: drawnTicket.orderId,
          userId: drawnTicket.userId,
          ticketNumber: drawnTicket.ticketNumber,
          drawnByAdminId: adminUser?.userId,
        },
      });

      await tx.raffle.update({
        where: { id: raffleId },
        data: { status: RaffleStatus.ENDED },
      });

      return createdWinner;
    });

    return this.prisma.winner.findUnique({
      where: { id: winner.id },
      include: {
        raffle: {
          select: {
            id: true,
            title: true,
            image: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNsu: true,
            selectedTickets: true,
          },
        },
      },
    });
  }
}
