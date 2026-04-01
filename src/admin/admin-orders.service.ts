import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const revenueSeriesStart = new Date(todayStart);
    revenueSeriesStart.setDate(revenueSeriesStart.getDate() - 13);

    const [
      paidAgg,
      revenueTodayAgg,
      paidOrdersToday,
      pendingOrders,
      activeRaffles,
      endedRaffles,
      newUsersLast7Days,
      paidOrdersCount,
      totalOrdersCount,
      pendingStatusCount,
      paidStatusCount,
      failedStatusCount,
      cancelledStatusCount,
      expiredStatusCount,
      waitingPaymentCount,
      paidOrdersForTopRaffles,
      paidOrdersForSeries,
      userOriginsGrouped,
      orderOriginsGrouped,
      paidRevenueByOriginGrouped,
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
      this.prisma.raffle.count({
        where: { status: 'ACTIVE' },
      }),
      this.prisma.raffle.count({
        where: { status: 'ENDED' },
      }),
      this.prisma.user.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
            lt: tomorrowStart,
          },
        },
      }),
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
          totalAmount: true,
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
      this.prisma.order.findMany({
        where: { status: OrderStatus.PAID },
        select: {
          refCode: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          totalAmount: true,
        },
      }),
    ]);

    const totalRevenue = paidAgg._sum.totalAmount || 0;
    const revenueToday = revenueTodayAgg._sum.totalAmount || 0;
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
    for (let i = 0; i < 14; i += 1) {
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

    const revenueByRaffle = new Map<string, number>();
    for (const order of paidOrdersForTopRaffles) {
      const current = revenueByRaffle.get(order.raffleId) || 0;
      revenueByRaffle.set(
        order.raffleId,
        Number((current + order.totalAmount).toFixed(2)),
      );
    }

    const topRafflesRaw = Array.from(revenueByRaffle.entries())
      .map(([raffleId, revenue]) => ({
        raffleId,
        revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 7);

    const topRaffleIds = topRafflesRaw.map((item) => item.raffleId);
    const topRafflesData = topRaffleIds.length
      ? await this.prisma.raffle.findMany({
          where: { id: { in: topRaffleIds } },
          select: { id: true, title: true },
        })
      : [];

    const raffleTitleById = new Map(topRafflesData.map((item) => [item.id, item.title]));
    const topRafflesByRevenue = topRafflesRaw.map((item) => ({
      raffleId: item.raffleId,
      title: raffleTitleById.get(item.raffleId) || `Rifa ${item.raffleId}`,
      revenue: item.revenue || 0,
    }));

    const originPerformance = this.buildOriginPerformance({
      userOriginsGrouped,
      orderOriginsGrouped,
      paidRevenueByOriginGrouped,
    });

    return {
      totalRevenue,
      revenueToday,
      paidOrdersToday,
      pendingOrders,
      activeRaffles,
      endedRaffles,
      averageTicket,
      newUsersLast7Days,
      conversionRate,
      totalOrders: totalOrdersCount,
      paidOrders: paidOrdersCount,
      revenueByDay,
      ordersByStatus,
      topRafflesByRevenue,
      originPerformance,
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
      select: { id: true, status: true, orderNsu: true },
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
        providerTransactionNsu:
          (await this.prisma.order.findUnique({
            where: { id: orderId },
            select: { providerTransactionNsu: true },
          }))?.providerTransactionNsu ||
          `MANUAL-${Date.now()}`,
      },
    });

    return {
      success: true,
      message: `Pagamento confirmado manualmente por ${adminUserId || 'admin'}.`,
      order: await this.getOrderById(orderId),
    };
  }

  async cancelOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
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

    return {
      success: true,
      message: 'Pedido cancelado com sucesso.',
      order: await this.getOrderById(orderId),
    };
  }

  async reprocessOrderStatus(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    if (!order.providerTransactionNsu) {
      return {
        success: true,
        message:
          'Pedido sem providerTransactionNsu. Nenhuma consulta externa executada.',
        order: await this.getOrderById(orderId),
      };
    }

    if (order.provider !== 'ASAAS') {
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
