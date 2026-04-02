import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';
import { DiscordLogsService } from '../discord-logs/discord-logs.service';
import { PrismaService } from '../prisma/prisma.service';

interface ListUsersInput {
  page?: number;
  limit?: number;
  search?: string;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogsService: DiscordLogsService,
  ) {}

  async listUsers(input: ListUsersInput) {
    const page = this.normalizePage(input.page);
    const limit = this.normalizeLimit(input.limit);
    const skip = (page - 1) * limit;
    const where = this.buildWhere(input.search);

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          steamId: true,
          role: true,
          isBlocked: true,
          blockedAt: true,
          blockedReason: true,
          blockedByAdminId: true,
          createdAt: true,
          updatedAt: true,
          orders: {
            select: {
              id: true,
              status: true,
              totalAmount: true,
              createdAt: true,
              updatedAt: true,
              customerWhatsapp: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items: users.map((user) => this.toUserSummary(user)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        steamId: true,
        steamAvatar: true,
        provider: true,
        role: true,
        isBlocked: true,
        blockedAt: true,
        blockedReason: true,
        blockedByAdminId: true,
        createdAt: true,
        updatedAt: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderNsu: true,
            status: true,
            totalAmount: true,
            selectedTickets: true,
            customerWhatsapp: true,
            createdAt: true,
            updatedAt: true,
            raffle: {
              select: {
                id: true,
                title: true,
                image: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    const summary = this.toUserSummary(user);
    const rafflesParticipatedMap = new Map<string, { id: string; title: string }>();

    user.orders.forEach((order) => {
      if (order.raffle?.id && !rafflesParticipatedMap.has(order.raffle.id)) {
        rafflesParticipatedMap.set(order.raffle.id, {
          id: order.raffle.id,
          title: order.raffle.title,
        });
      }
    });

    return {
      ...summary,
      accountStatus: user.isBlocked ? 'BLOCKED' : 'ACTIVE',
      ordersHistory: user.orders,
      rafflesParticipated: Array.from(rafflesParticipatedMap.values()),
      provider: user.provider,
      steamAvatar: user.steamAvatar,
      blockedReason: user.blockedReason || null,
      blockedByAdminId: user.blockedByAdminId || null,
    };
  }

  async promoteToAdmin(targetUserId: string, adminUserId?: string) {
    const user = await this.requireUser(targetUserId);

    if (user.role === UserRole.ADMIN) {
      return {
        success: true,
        message: 'Usuario ja possui permissao de ADMIN.',
        user: await this.getUserDetail(targetUserId),
      };
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: UserRole.ADMIN },
    });

    void this.discordLogsService.sendAdminLog({
      title: 'Usuario promovido para ADMIN',
      description: 'Permissao elevada no painel admin.',
      fields: [
        { name: 'targetUserId', value: targetUserId, inline: true },
        { name: 'action', value: 'PROMOTE_ADMIN', inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return {
      success: true,
      message: `Usuario promovido para ADMIN por ${adminUserId || 'admin'}.`,
      user: await this.getUserDetail(targetUserId),
    };
  }

  async removeAdmin(targetUserId: string, adminUserId?: string) {
    const user = await this.requireUser(targetUserId);

    if (user.role !== UserRole.ADMIN) {
      return {
        success: true,
        message: 'Usuario ja nao possui perfil ADMIN.',
        user: await this.getUserDetail(targetUserId),
      };
    }

    if (targetUserId === adminUserId) {
      throw new BadRequestException('Voce nao pode remover seu proprio perfil ADMIN.');
    }

    const adminCount = await this.prisma.user.count({
      where: { role: UserRole.ADMIN },
    });

    if (adminCount <= 1) {
      throw new BadRequestException('Nao e possivel remover o ultimo ADMIN da plataforma.');
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: UserRole.USER },
    });

    void this.discordLogsService.sendAdminLog({
      title: 'Permissao ADMIN removida',
      description: 'Usuario voltou ao perfil USER no painel admin.',
      fields: [
        { name: 'targetUserId', value: targetUserId, inline: true },
        { name: 'action', value: 'REMOVE_ADMIN', inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return {
      success: true,
      message: `Permissao ADMIN removida por ${adminUserId || 'admin'}.`,
      user: await this.getUserDetail(targetUserId),
    };
  }

  async blockUser(
    targetUserId: string,
    adminUserId?: string,
    reasonInput?: string,
  ) {
    const user = await this.requireUser(targetUserId);

    if (targetUserId === adminUserId) {
      throw new BadRequestException('Voce nao pode bloquear sua propria conta.');
    }

    if (user.isBlocked) {
      return {
        success: true,
        message: 'Usuario ja esta bloqueado.',
        user: await this.getUserDetail(targetUserId),
      };
    }

    const blockReason =
      String(reasonInput || '').trim().slice(0, 240) ||
      'Bloqueio manual efetuado no painel admin.';

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        isBlocked: true,
        blockedAt: new Date(),
        blockedReason: blockReason,
        blockedByAdminId: adminUserId || null,
      },
    });

    void this.discordLogsService.sendAdminLog({
      title: 'Usuario bloqueado',
      description: 'Conta bloqueada no painel admin.',
      fields: [
        { name: 'targetUserId', value: targetUserId, inline: true },
        { name: 'action', value: 'BLOCK_USER', inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
        { name: 'reason', value: blockReason, inline: false },
      ],
    });

    return {
      success: true,
      message: `Usuario bloqueado por ${adminUserId || 'admin'}.`,
      user: await this.getUserDetail(targetUserId),
    };
  }

  async unblockUser(targetUserId: string, adminUserId?: string) {
    const user = await this.requireUser(targetUserId);

    if (!user.isBlocked) {
      return {
        success: true,
        message: 'Usuario ja esta desbloqueado.',
        user: await this.getUserDetail(targetUserId),
      };
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        isBlocked: false,
        blockedAt: null,
        blockedReason: null,
        blockedByAdminId: null,
      },
    });

    void this.discordLogsService.sendAdminLog({
      title: 'Usuario desbloqueado',
      description: 'Conta desbloqueada no painel admin.',
      fields: [
        { name: 'targetUserId', value: targetUserId, inline: true },
        { name: 'action', value: 'UNBLOCK_USER', inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return {
      success: true,
      message: `Usuario desbloqueado por ${adminUserId || 'admin'}.`,
      user: await this.getUserDetail(targetUserId),
    };
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isBlocked: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    return user;
  }

  private normalizePage(page?: number) {
    if (!page || Number.isNaN(page)) return 1;
    return Math.max(1, Math.floor(page));
  }

  private normalizeLimit(limit?: number) {
    if (!limit || Number.isNaN(limit)) return 20;
    return Math.min(100, Math.max(1, Math.floor(limit)));
  }

  private buildWhere(searchRaw?: string): Prisma.UserWhereInput {
    const search = (searchRaw || '').trim();
    if (!search) return {};

    return {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { steamId: { contains: search, mode: 'insensitive' } },
        {
          orders: {
            some: {
              customerWhatsapp: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
      ],
    };
  }

  private toUserSummary(user: any) {
    const totalSpent = user.orders
      .filter((order: any) => order.status === OrderStatus.PAID)
      .reduce((acc: number, order: any) => acc + order.totalAmount, 0);

    const ordersCount = user.orders.length;

    const orderDates = user.orders.map((order: any) =>
      new Date(order.updatedAt || order.createdAt).getTime(),
    );

    const latestActivityTime = Math.max(
      new Date(user.updatedAt).getTime(),
      ...(orderDates.length ? orderDates : [new Date(user.createdAt).getTime()]),
    );

    const latestWhatsapp = user.orders
      .map((order: any) => order.customerWhatsapp)
      .find((value: string | null) => !!value);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      steamId: user.steamId,
      whatsapp: latestWhatsapp || null,
      role: user.role,
      isBlocked: user.isBlocked,
      blockedAt: user.blockedAt,
      blockedReason: user.blockedReason || null,
      blockedByAdminId: user.blockedByAdminId || null,
      createdAt: user.createdAt,
      totalSpent,
      ordersCount,
      lastActivity: new Date(latestActivityTime).toISOString(),
    };
  }
}
