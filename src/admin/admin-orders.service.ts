import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { DiscordLogsService } from '../discord-logs/discord-logs.service';
import { PrismaService } from '../prisma/prisma.service';

interface ListOrdersInput {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

interface OriginGroupRow {
  refCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface OriginPerformanceRow extends OriginGroupRow {
  sourceKey: string;
  signups: number;
  orders: number;
  revenue: number;
}

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogsService: DiscordLogsService,
  ) {}

  async listOrders(input: ListOrdersInput) {
    const page = this.normalizePage(input.page);
    const limit = this.normalizeLimit(input.limit);
    const skip = (page - 1) * limit;
    const where = this.buildWhere(input.status, input.search);

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          raffle: {
            select: {
              id: true,
              title: true,
              image: true,
              pricePerTicket: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items: orders.map((order) => this.toOrderSummary(order)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getOrderMetrics() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const [paidAgg, paidToday, pending, totalOrders, paidCount] =
      await this.prisma.$transaction([
        this.prisma.order.aggregate({
          where: { status: OrderStatus.PAID },
          _sum: { totalAmount: true },
        }),
        this.prisma.order.count({
          where: {
            status: OrderStatus.PAID,
            updatedAt: {
              gte: todayStart,
              lt: tomorrowStart,
            },
          },
        }),
        this.prisma.order.count({
          where: { status: OrderStatus.PENDING },
        }),
        this.prisma.order.count(),
        this.prisma.order.count({
          where: { status: OrderStatus.PAID },
        }),
      ]);

    const totalRevenue = paidAgg._sum.totalAmount || 0;
    const conversionRate =
      totalOrders > 0 ? Number(((paidCount / totalOrders) * 100).toFixed(2)) : 0;

    return {
      totalRevenue,
      paidToday,
      pendingOrders: pending,
      conversionRate,
      totalOrders,
      paidOrders: paidCount,
    };
  }

  async getDashboardMetrics() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

    const revenueSeriesStart = new Date(thirtyDaysAgo);

    const [
      paidAgg,
      revenueTodayAgg,
      revenueLast7Agg,
      revenueLast30Agg,
      paidOrdersToday,
      pendingOrders,
      expiredOrders,
      activeRaffles,
      endedRaffles,
      newUsersLast7Days,
      totalUsers,
      paidOrdersCount,
      totalOrdersCount,
      pendingStatusCount,
      paidStatusCount,
      failedStatusCount,
      cancelledStatusCount,
      expiredStatusCount,
      waitingPaymentCount,
      paidOrdersForAnalysis,
      paidOrdersForSeries,
      userOriginsGrouped,
      orderOriginsGrouped,
    ] = await this.prisma.$transaction([
      this.prisma.order.aggregate({
        where: { status: OrderStatus.PAID },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: OrderStatus.PAID,
          updatedAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: OrderStatus.PAID,
          updatedAt: {
            gte: sevenDaysAgo,
            lt: tomorrowStart,
          },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: OrderStatus.PAID,
          updatedAt: {
            gte: thirtyDaysAgo,
            lt: tomorrowStart,
          },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.PAID,
          updatedAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
      }),
      this.prisma.order.count({
        where: { status: OrderStatus.PENDING },
      }),
      this.prisma.order.count({
        where: { status: OrderStatus.EXPIRED },
      }),
      this.prisma.raffle.count({
        where: {
          status: 'ACTIVE',
          AND: [
            {
              OR: [{ publishAt: null }, { publishAt: { lte: now } }],
            },
            {
              OR: [{ endAt: null }, { endAt: { gt: now } }],
            },
          ],
        },
      }),
      this.prisma.raffle.count({
        where: {
          OR: [
            { status: 'ENDED' },
            { status: 'ACTIVE', endAt: { lte: now } },
          ],
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
            lt: tomorrowStart,
          },
        },
      }),
      this.prisma.user.count(),
      this.prisma.order.count({
        where: { status: OrderStatus.PAID },
      }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.PENDING } }),
      this.prisma.order.count({ where: { status: OrderStatus.PAID } }),
      this.prisma.order.count({ where: { status: OrderStatus.FAILED } }),
      this.prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
      this.prisma.order.count({ where: { status: OrderStatus.EXPIRED } }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.PENDING,
          provider: 'ASAAS',
        },
      }),
      this.prisma.order.findMany({
        where: {
          status: OrderStatus.PAID,
        },
        select: {
          raffleId: true,
          userId: true,
          totalAmount: true,
          couponCode: true,
          refCode: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
        },
      }),
      this.prisma.order.findMany({
        where: {
          status: OrderStatus.PAID,
          updatedAt: {
            gte: revenueSeriesStart,
            lt: tomorrowStart,
          },
        },
        select: {
          updatedAt: true,
          totalAmount: true,
        },
      }),
      this.prisma.user.findMany({
        select: {
          refCode: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
        },
      }),
      this.prisma.order.findMany({
        select: {
          refCode: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
        },
      }),
    ]);

    const totalRevenue = paidAgg._sum.totalAmount || 0;
    const revenueToday = revenueTodayAgg._sum.totalAmount || 0;
    const revenueLast7Days = revenueLast7Agg._sum.totalAmount || 0;
    const revenueLast30Days = revenueLast30Agg._sum.totalAmount || 0;
    const averageTicket =
      paidOrdersCount > 0 ? Number((totalRevenue / paidOrdersCount).toFixed(2)) : 0;
    const conversionRate =
      totalOrdersCount > 0
        ? Number(((paidOrdersCount / totalOrdersCount) * 100).toFixed(2))
        : 0;

    const pendingWithoutWaitingPayment = Math.max(
      0,
      pendingStatusCount - waitingPaymentCount,
    );

    const ordersByStatus = [
      { status: 'WAITING_PAYMENT', count: waitingPaymentCount },
      { status: 'PENDING', count: pendingWithoutWaitingPayment },
      { status: 'PAID', count: paidStatusCount },
      { status: 'FAILED', count: failedStatusCount },
      { status: 'CANCELLED', count: cancelledStatusCount },
      { status: 'EXPIRED', count: expiredStatusCount },
    ];

    const revenueByDayMap = new Map<string, number>();
    for (let i = 0; i < 30; i += 1) {
      const date = new Date(revenueSeriesStart);
      date.setDate(revenueSeriesStart.getDate() + i);
      revenueByDayMap.set(this.toDateKey(date), 0);
    }

    for (const order of paidOrdersForSeries) {
      const key = this.toDateKey(order.updatedAt);
      const current = revenueByDayMap.get(key) || 0;
      revenueByDayMap.set(key, Number((current + order.totalAmount).toFixed(2)));
    }

    const revenueByDay = Array.from(revenueByDayMap.entries()).map(
      ([date, amount]) => ({
        date,
        amount,
      }),
    );

    const raffleAggregates = new Map<
      string,
      { revenue: number; orders: number; participants: Set<string> }
    >();
    const couponAggregates = new Map<
      string,
      { code: string; orders: number; revenue: number }
    >();

    for (const order of paidOrdersForAnalysis) {
      const currentRaffle = raffleAggregates.get(order.raffleId) || {
        revenue: 0,
        orders: 0,
        participants: new Set<string>(),
      };

      currentRaffle.revenue = Number(
        (currentRaffle.revenue + Number(order.totalAmount || 0)).toFixed(2),
      );
      currentRaffle.orders += 1;
      currentRaffle.participants.add(order.userId);
      raffleAggregates.set(order.raffleId, currentRaffle);

      const normalizedCoupon = String(order.couponCode || '')
        .trim()
        .toUpperCase();
      if (normalizedCoupon) {
        const currentCoupon = couponAggregates.get(normalizedCoupon) || {
          code: normalizedCoupon,
          orders: 0,
          revenue: 0,
        };
        currentCoupon.orders += 1;
        currentCoupon.revenue = Number(
          (currentCoupon.revenue + Number(order.totalAmount || 0)).toFixed(2),
        );
        couponAggregates.set(normalizedCoupon, currentCoupon);
      }
    }

    const byRevenueRaw = Array.from(raffleAggregates.entries())
      .map(([raffleId, values]) => ({
        raffleId,
        revenue: values.revenue,
        orders: values.orders,
        participants: values.participants.size,
      }))
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        if (b.orders !== a.orders) return b.orders - a.orders;
        return b.participants - a.participants;
      })
      .slice(0, 5);

    const byOrdersRaw = Array.from(raffleAggregates.entries())
      .map(([raffleId, values]) => ({
        raffleId,
        revenue: values.revenue,
        orders: values.orders,
        participants: values.participants.size,
      }))
      .sort((a, b) => {
        if (b.orders !== a.orders) return b.orders - a.orders;
        if (b.participants !== a.participants) return b.participants - a.participants;
        return b.revenue - a.revenue;
      })
      .slice(0, 5);

    const topRaffleIds = Array.from(
      new Set([
        ...byRevenueRaw.map((item) => item.raffleId),
        ...byOrdersRaw.map((item) => item.raffleId),
      ]),
    );

    const topRafflesData = topRaffleIds.length
      ? await this.prisma.raffle.findMany({
          where: { id: { in: topRaffleIds } },
          select: { id: true, title: true },
        })
      : [];

    const raffleTitleById = new Map(topRafflesData.map((item) => [item.id, item.title]));

    const topRafflesByRevenue = byRevenueRaw.map((item) => ({
      raffleId: item.raffleId,
      title: raffleTitleById.get(item.raffleId) || `Rifa ${item.raffleId}`,
      revenue: item.revenue || 0,
      orders: item.orders || 0,
      participants: item.participants || 0,
    }));

    const topRafflesByOrders = byOrdersRaw.map((item) => ({
      raffleId: item.raffleId,
      title: raffleTitleById.get(item.raffleId) || `Rifa ${item.raffleId}`,
      orders: item.orders || 0,
      participants: item.participants || 0,
      revenue: item.revenue || 0,
    }));

    const topCoupons = Array.from(couponAggregates.values())
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        return b.orders - a.orders;
      })
      .slice(0, 5)
      .map((item) => ({
        code: item.code,
        orders: item.orders,
        revenue: item.revenue,
      }));

    const paidRevenueByOriginGrouped = paidOrdersForAnalysis.map((order) => ({
      refCode: order.refCode,
      utmSource: order.utmSource,
      utmMedium: order.utmMedium,
      utmCampaign: order.utmCampaign,
      totalAmount: order.totalAmount,
    }));

    const originPerformance = this.buildOriginPerformance({
      userOriginsGrouped,
      orderOriginsGrouped,
      paidRevenueByOriginGrouped,
    });

    const topOrigins = originPerformance.slice(0, 5);

    return {
      totalRevenue,
      revenueToday,
      revenueLast7Days,
      revenueLast30Days,
      paidOrdersToday,
      pendingOrders,
      expiredOrders,
      activeRaffles,
      endedRaffles,
      averageTicket,
      newUsersLast7Days,
      totalUsers,
      conversionRate,
      totalOrders: totalOrdersCount,
      paidOrders: paidOrdersCount,
      revenueByDay,
      ordersByStatus,
      topRafflesByRevenue,
      topRafflesByOrders,
      topCoupons,
      originPerformance,
      topOrigins,
    };
  }

  async getAnalyticsOverview() {
    return this.getDashboardMetrics();
  }

  async getAnalyticsRevenueSeries(daysRaw?: number) {
    const metrics = await this.getDashboardMetrics();
    const normalizedDays = Number.isFinite(daysRaw)
      ? Math.min(90, Math.max(1, Math.floor(daysRaw as number)))
      : 30;

    return {
      days: normalizedDays,
      series: metrics.revenueByDay.slice(-normalizedDays),
    };
  }

  async getAnalyticsTopRaffles() {
    const metrics = await this.getDashboardMetrics();
    return {
      byRevenue: metrics.topRafflesByRevenue,
      byOrders: metrics.topRafflesByOrders,
    };
  }

  async getOrderById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        raffle: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    const providerPayload = await this.fetchProviderPayload(order);

    return {
      ...this.toOrderSummary(order),
      selectedTickets: order.selectedTickets,
      paymentPayload: {
        provider: order.provider,
        providerTransactionNsu: order.providerTransactionNsu,
        paymentMethod: order.paymentMethod,
        receiptUrl: order.receiptUrl,
        externalData: providerPayload,
      },
      timestamps: {
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        paidAt: order.status === OrderStatus.PAID ? order.updatedAt : null,
      },
    };
  }

  async confirmPaymentManually(orderId: string, adminUserId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        orderNsu: true,
        providerTransactionNsu: true,
        totalAmount: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException(
        'Pedido cancelado nao pode ser confirmado manualmente.',
      );
    }

    if (order.status === OrderStatus.PAID) {
      return {
        success: true,
        message: 'Pedido ja estava confirmado como pago.',
        order: await this.getOrderById(orderId),
      };
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.PAID,
        providerTransactionNsu: order.providerTransactionNsu || `MANUAL-${Date.now()}`,
      },
    });

    void this.discordLogsService.sendPaymentLog({
      title: 'Pagamento confirmado manualmente',
      description: 'Pedido confirmado manualmente no painel admin.',
      fields: [
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'status', value: 'PAID', inline: true },
        { name: 'total', value: order.totalAmount, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    void this.discordLogsService.sendAdminLog({
      title: 'Admin confirmou pagamento',
      description: 'Acao sensivel executada no painel admin.',
      fields: [
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return {
      success: true,
      message: `Pagamento confirmado manualmente por ${adminUserId || 'admin'}.`,
      order: await this.getOrderById(orderId),
    };
  }

  async cancelOrder(orderId: string, adminUserId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        orderNsu: true,
        totalAmount: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    if (order.status === OrderStatus.PAID) {
      throw new BadRequestException(
        'Pedido pago nao pode ser cancelado por esta acao.',
      );
    }

    if (order.status === OrderStatus.CANCELLED) {
      return {
        success: true,
        message: 'Pedido ja estava cancelado.',
        order: await this.getOrderById(orderId),
      };
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });

    void this.discordLogsService.sendPaymentLog({
      title: 'Pedido cancelado manualmente',
      description: 'Pedido cancelado no painel admin.',
      fields: [
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'status', value: 'CANCELLED', inline: true },
        { name: 'total', value: order.totalAmount, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    void this.discordLogsService.sendAdminLog({
      title: 'Admin cancelou pedido',
      description: 'Acao sensivel executada no painel admin.',
      fields: [
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return {
      success: true,
      message: 'Pedido cancelado com sucesso.',
      order: await this.getOrderById(orderId),
    };
  }

  async reprocessOrderStatus(orderId: string, adminUserId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    if (!order.providerTransactionNsu) {
      void this.discordLogsService.sendAdminLog({
        title: 'Reprocessamento sem providerTransactionNsu',
        description: 'Reprocessamento solicitado para pedido sem identificador externo.',
        fields: [
          { name: 'orderId', value: order.id, inline: true },
          { name: 'orderNsu', value: order.orderNsu, inline: true },
          { name: 'adminId', value: adminUserId || '-', inline: true },
        ],
      });
      return {
        success: true,
        message:
          'Pedido sem providerTransactionNsu. Nenhuma consulta externa executada.',
        order: await this.getOrderById(orderId),
      };
    }

    if (order.provider !== 'ASAAS') {
      void this.discordLogsService.sendAdminLog({
        title: 'Reprocessamento indisponivel para provider',
        description: 'Reprocessamento solicitado para provider sem suporte automatico.',
        fields: [
          { name: 'orderId', value: order.id, inline: true },
          { name: 'orderNsu', value: order.orderNsu, inline: true },
          { name: 'provider', value: order.provider, inline: true },
          { name: 'adminId', value: adminUserId || '-', inline: true },
        ],
      });
      return {
        success: true,
        message: `Reprocessamento automatico indisponivel para provider ${order.provider}.`,
        order: await this.getOrderById(orderId),
      };
    }

    const asaasPayment = await this.fetchAsaasPaymentById(
      order.providerTransactionNsu,
    );
    const mappedStatus = this.mapAsaasStatusToOrderStatus(asaasPayment?.status);

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: mappedStatus,
        receiptUrl: asaasPayment?.invoiceUrl || order.receiptUrl,
      },
    });

    void this.discordLogsService.sendPaymentLog({
      title: 'Status de pagamento reprocessado',
      description: 'Status atualizado a partir de consulta manual no provider.',
      fields: [
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'provider', value: order.provider, inline: true },
        { name: 'providerStatus', value: asaasPayment?.status || '-', inline: true },
        { name: 'mappedStatus', value: mappedStatus, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    void this.discordLogsService.sendAdminLog({
      title: 'Admin reprocessou status de pedido',
      description: 'Acao sensivel executada no painel admin.',
      fields: [
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'mappedStatus', value: mappedStatus, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return {
      success: true,
      message: `Status reprocessado para ${mappedStatus}.`,
      providerStatus: asaasPayment?.status || null,
      order: await this.getOrderById(orderId),
    };
  }

  async deleteCustomerData(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        customerFullName: null,
        customerEmail: null,
        customerWhatsapp: null,
        customerTradeLink: null,
        customerCpfCnpj: null,
      },
    });

    return {
      success: true,
      message: 'Dados do comprador removidos com sucesso.',
      order: await this.getOrderById(orderId),
    };
  }

  private buildOriginPerformance(input: {
    userOriginsGrouped: OriginGroupRow[];
    orderOriginsGrouped: OriginGroupRow[];
    paidRevenueByOriginGrouped: Array<OriginGroupRow & { totalAmount: number }>;
  }) {
    const map = new Map<string, OriginPerformanceRow>();

    const touch = (row: OriginGroupRow) => {
      const normalized = this.normalizeOriginRow(row);
      const sourceKey = this.buildOriginKey(normalized);
      const current = map.get(sourceKey);

      if (current) {
        return current;
      }

      const created: OriginPerformanceRow = {
        sourceKey,
        refCode: normalized.refCode,
        utmSource: normalized.utmSource,
        utmMedium: normalized.utmMedium,
        utmCampaign: normalized.utmCampaign,
        signups: 0,
        orders: 0,
        revenue: 0,
      };
      map.set(sourceKey, created);
      return created;
    };

    for (const row of input.userOriginsGrouped) {
      const target = touch(row);
      target.signups += 1;
    }

    for (const row of input.orderOriginsGrouped) {
      const target = touch(row);
      target.orders += 1;
    }

    for (const row of input.paidRevenueByOriginGrouped) {
      const target = touch(row);
      target.revenue = Number(
        (target.revenue + Number(row.totalAmount || 0)).toFixed(2),
      );
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      if (b.orders !== a.orders) return b.orders - a.orders;
      if (b.signups !== a.signups) return b.signups - a.signups;
      return a.sourceKey.localeCompare(b.sourceKey);
    });
  }

  private normalizeOriginRow(row: OriginGroupRow): OriginGroupRow {
    return {
      refCode: this.normalizeOriginValue(row.refCode),
      utmSource: this.normalizeOriginValue(row.utmSource),
      utmMedium: this.normalizeOriginValue(row.utmMedium),
      utmCampaign: this.normalizeOriginValue(row.utmCampaign),
    };
  }

  private buildOriginKey(row: OriginGroupRow) {
    const parts: string[] = [];
    if (row.refCode) parts.push(`ref=${row.refCode}`);
    if (row.utmSource) parts.push(`utm_source=${row.utmSource}`);
    if (row.utmMedium) parts.push(`utm_medium=${row.utmMedium}`);
    if (row.utmCampaign) parts.push(`utm_campaign=${row.utmCampaign}`);
    return parts.length ? parts.join('|') : 'DIRECT';
  }

  private normalizeOriginValue(raw?: string | null) {
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    return value.slice(0, 120);
  }

  private normalizePage(page?: number) {
    if (!page || Number.isNaN(page)) return 1;
    return Math.max(1, Math.floor(page));
  }

  private normalizeLimit(limit?: number) {
    if (!limit || Number.isNaN(limit)) return 20;
    return Math.min(100, Math.max(1, Math.floor(limit)));
  }

  private buildWhere(statusRaw?: string, searchRaw?: string): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    const status = this.normalizeStatus(statusRaw);

    if (status === 'WAITING_PAYMENT') {
      where.status = OrderStatus.PENDING;
    } else if (status) {
      where.status = status;
    }

    const search = (searchRaw || '').trim();
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { orderNsu: { contains: search, mode: 'insensitive' } },
        { customerFullName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerWhatsapp: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  private normalizeStatus(statusRaw?: string) {
    const value = (statusRaw || '').trim().toUpperCase();
    if (!value) return null;

    if (value === 'WAITING_PAYMENT') return 'WAITING_PAYMENT' as const;
    if (value === OrderStatus.PENDING) return OrderStatus.PENDING;
    if (value === OrderStatus.PAID) return OrderStatus.PAID;
    if (value === OrderStatus.FAILED) return OrderStatus.FAILED;
    if (value === OrderStatus.CANCELLED) return OrderStatus.CANCELLED;
    if (value === OrderStatus.EXPIRED) return OrderStatus.EXPIRED;
    return null;
  }

  private toDateKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toOrderSummary(order: any) {
    const statusView =
      order.status === OrderStatus.PENDING && order.provider === 'ASAAS'
        ? 'WAITING_PAYMENT'
        : order.status;

    return {
      id: order.id,
      orderNsu: order.orderNsu,
      status: statusView,
      totalAmount: order.totalAmount,
      selectedTickets: order.selectedTickets,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      paidAt: order.status === OrderStatus.PAID ? order.updatedAt : null,
      provider: order.provider,
      providerTransactionNsu: order.providerTransactionNsu,
      receiptUrl: order.receiptUrl,
      paymentMethod: order.paymentMethod,
      customerFullName: order.customerFullName,
      customerEmail: order.customerEmail,
      customerWhatsapp: order.customerWhatsapp,
      customerTradeLink: order.customerTradeLink,
      customerCpfCnpj: order.customerCpfCnpj,
      refCode: order.refCode || null,
      utmSource: order.utmSource || null,
      utmMedium: order.utmMedium || null,
      utmCampaign: order.utmCampaign || null,
      raffle: order.raffle,
      user: order.user,
    };
  }

  private async fetchProviderPayload(order: any) {
    if (order.provider !== 'ASAAS' || !order.providerTransactionNsu) {
      return null;
    }

    try {
      return await this.fetchAsaasPaymentById(order.providerTransactionNsu);
    } catch {
      return null;
    }
  }

  private mapAsaasStatusToOrderStatus(status?: string): OrderStatus {
    const normalized = (status || '').toUpperCase();

    if (
      normalized === 'CONFIRMED' ||
      normalized === 'RECEIVED' ||
      normalized === 'RECEIVED_IN_CASH'
    ) {
      return OrderStatus.PAID;
    }

    if (normalized === 'OVERDUE') {
      return OrderStatus.EXPIRED;
    }

    if (
      normalized === 'DELETED' ||
      normalized === 'REFUNDED' ||
      normalized === 'REFUND_REQUESTED' ||
      normalized === 'CHARGEBACK_REQUESTED' ||
      normalized === 'CHARGEBACK_DISPUTE' ||
      normalized === 'AWAITING_CHARGEBACK_REVERSAL' ||
      normalized === 'DUNNING_REQUESTED' ||
      normalized === 'DUNNING_RECEIVED' ||
      normalized === 'DUNNING_CREDIT_BUREAU'
    ) {
      return OrderStatus.CANCELLED;
    }

    if (
      normalized === 'PENDING' ||
      normalized === 'AWAITING_RISK_ANALYSIS' ||
      normalized === 'AUTHORIZED'
    ) {
      return OrderStatus.PENDING;
    }

    return OrderStatus.FAILED;
  }

  private async fetchAsaasPaymentById(paymentId: string) {
    const apiKey = process.env.ASAAS_API_KEY;
    const baseUrl = process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3';

    if (!apiKey) {
      throw new BadRequestException(
        'ASAAS_API_KEY nao configurada para reprocessar pagamento.',
      );
    }

    const response = await fetch(`${baseUrl}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        access_token: apiKey,
      },
    });

    const responseText = await response.text();
    let data: any = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok) {
      throw new BadRequestException(
        `Falha ao consultar Asaas: ${
          data?.errors?.[0]?.description || data?.raw || 'erro desconhecido'
        }`,
      );
    }

    return data;
  }
}
