import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RaffleStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DiscordLogsService } from '../discord-logs/discord-logs.service';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/raffles')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogsService: DiscordLogsService,
  ) {}

  @Post()
  async createRaffle(@Body() data: any, @CurrentUser() adminUser: any) {
    const raffle = await this.prisma.raffle.create({
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

    void this.discordLogsService.sendRaffleLog({
      title: 'Rifa criada',
      description: 'Nova rifa criada no painel admin.',
      fields: [
        { name: 'raffleId', value: raffle.id, inline: true },
        { name: 'title', value: raffle.title, inline: true },
        { name: 'status', value: raffle.status, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
    });

    return raffle;
  }

  @Patch(':id')
  async updateRaffle(
    @Param('id') id: string,
    @Body() data: any,
    @CurrentUser() adminUser: any,
  ) {
    const raffle = await this.prisma.raffle.update({
      where: { id },
      data,
    });

    void this.discordLogsService.sendRaffleLog({
      title: 'Rifa editada',
      description: 'Rifa atualizada no painel admin.',
      fields: [
        { name: 'raffleId', value: raffle.id, inline: true },
        { name: 'title', value: raffle.title, inline: true },
        { name: 'status', value: raffle.status, inline: true },
        {
          name: 'changedFields',
          value: Object.keys(data || {}).join(', ') || '-',
        },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
    });

    return raffle;
  }

  @Patch(':id/publish')
  async publishRaffle(@Param('id') id: string, @CurrentUser() adminUser: any) {
    const raffle = await this.prisma.raffle.update({
      where: { id },
      data: { status: RaffleStatus.ACTIVE },
    });

    void this.discordLogsService.sendRaffleLog({
      title: 'Rifa publicada',
      description: 'Status da rifa alterado para ACTIVE.',
      fields: [
        { name: 'raffleId', value: raffle.id, inline: true },
        { name: 'title', value: raffle.title, inline: true },
        { name: 'status', value: raffle.status, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
    });

    return raffle;
  }

  @Patch(':id/pause')
  async pauseRaffle(@Param('id') id: string, @CurrentUser() adminUser: any) {
    const raffle = await this.prisma.raffle.update({
      where: { id },
      data: { status: RaffleStatus.PAUSED },
    });

    void this.discordLogsService.sendRaffleLog({
      title: 'Rifa pausada',
      description: 'Status da rifa alterado para PAUSED.',
      fields: [
        { name: 'raffleId', value: raffle.id, inline: true },
        { name: 'title', value: raffle.title, inline: true },
        { name: 'status', value: raffle.status, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
    });

    return raffle;
  }

  @Patch(':id/cancel')
  async cancelRaffle(@Param('id') id: string, @CurrentUser() adminUser: any) {
    const raffle = await this.prisma.raffle.update({
      where: { id },
      data: { status: RaffleStatus.CANCELLED },
    });

    void this.discordLogsService.sendRaffleLog({
      title: 'Rifa cancelada',
      description: 'Status da rifa alterado para CANCELLED.',
      fields: [
        { name: 'raffleId', value: raffle.id, inline: true },
        { name: 'title', value: raffle.title, inline: true },
        { name: 'status', value: raffle.status, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
    });

    return raffle;
  }

  @Delete(':id')
  async deleteRaffle(@Param('id') id: string, @CurrentUser() adminUser: any) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id },
      select: { id: true, title: true, status: true },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa nao encontrada.');
    }

    await this.prisma.$transaction([
      this.prisma.order.deleteMany({
        where: { raffleId: id },
      }),
      this.prisma.raffle.delete({
        where: { id },
      }),
    ]);

    void this.discordLogsService.sendRaffleLog({
      title: 'Rifa excluida',
      description: 'Rifa removida com exclusao em cascata dos pedidos vinculados.',
      fields: [
        { name: 'raffleId', value: raffle.id, inline: true },
        { name: 'title', value: raffle.title, inline: true },
        { name: 'status', value: raffle.status, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
    });

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
      throw new BadRequestException('userId e obrigatorio.');
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
      throw new NotFoundException('Rifa nao encontrada.');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario alvo nao encontrado.');
    }

    const occupiedTickets = raffle.orders.flatMap((o) => o.selectedTickets);
    const conflict = selectedTickets.some((ticket) => occupiedTickets.includes(ticket));

    if (conflict) {
      throw new BadRequestException('Uma ou mais cotas ja estao reservadas ou vendidas.');
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

    void this.discordLogsService.sendRaffleLog({
      title: 'Reserva manual criada',
      description: 'Admin reservou cotas manualmente.',
      fields: [
        { name: 'raffleId', value: raffleId, inline: true },
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'userId', value: userId, inline: true },
        { name: 'qtdCotas', value: selectedTickets.length, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
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
    @CurrentUser() adminUser: any,
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

    void this.discordLogsService.sendRaffleLog({
      title: 'Reserva manual removida',
      description: 'Admin liberou cotas reservadas manualmente.',
      fields: [
        { name: 'raffleId', value: raffleId, inline: true },
        { name: 'affectedOrders', value: orderIdsToCancel.length, inline: true },
        { name: 'qtdCotasSolicitadas', value: selectedTickets.length, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
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

    void this.discordLogsService.sendRaffleLog({
      title: 'Vencedor definido',
      description: 'Sorteio finalizado e vencedor registrado.',
      fields: [
        { name: 'raffleId', value: raffleId, inline: true },
        { name: 'winnerId', value: winner.id, inline: true },
        { name: 'userId', value: winner.userId, inline: true },
        { name: 'orderId', value: winner.orderId, inline: true },
        { name: 'ticketNumber', value: winner.ticketNumber, inline: true },
        { name: 'adminId', value: adminUser?.userId || '-', inline: true },
      ],
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
