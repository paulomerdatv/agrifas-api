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
