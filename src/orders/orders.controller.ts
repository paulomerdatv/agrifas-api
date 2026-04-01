import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DiscordLogsService } from '../discord-logs/discord-logs.service';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogsService: DiscordLogsService,
  ) {}

  @Post()
  async createOrder(
    @Body()
    body: {
      raffleId: string;
      selectedTickets: number[];
      origin?: {
        ref?: string;
        utm_source?: string;
        utm_medium?: string;
        utm_campaign?: string;
      };
    },
    @CurrentUser() user: any,
  ) {
    const { raffleId, selectedTickets } = body;

    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa nao encontrada.');
    }

    const totalAmount = selectedTickets.length * raffle.pricePerTicket;
    const trackingOrigin = this.resolveTrackingOrigin(body.origin);

    const order = await this.prisma.order.create({
      data: {
        user: {
          connect: { id: user.userId },
        },
        raffle: {
          connect: { id: raffleId },
        },
        selectedTickets,
        totalAmount,
        status: 'PENDING',
        provider: 'INFINITEPAY',
        orderNsu: `AGRIFAS-${Date.now()}`,
        paymentMethod: 'PIX',
        refCode: trackingOrigin.refCode,
        utmSource: trackingOrigin.utmSource,
        utmMedium: trackingOrigin.utmMedium,
        utmCampaign: trackingOrigin.utmCampaign,
      },
    });

    void this.discordLogsService.sendPaymentLog({
      title: 'Pedido criado',
      description: 'Pedido inicial criado via endpoint de pedidos.',
      fields: [
        { name: 'orderId', value: order.id, inline: true },
        { name: 'orderNsu', value: order.orderNsu, inline: true },
        { name: 'userId', value: user.userId, inline: true },
        { name: 'raffleId', value: raffleId, inline: true },
        { name: 'total', value: totalAmount, inline: true },
      ],
    });

    return order;
  }

  @Get('me')
  async getMyOrders(@CurrentUser() user: any) {
    return this.prisma.order.findMany({
      where: {
        user: {
          id: user.userId,
        },
      },
      include: {
        raffle: {
          select: { title: true, image: true, pricePerTicket: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private resolveTrackingOrigin(origin?: {
    ref?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  }) {
    return {
      refCode: this.normalizeOriginValue(origin?.ref),
      utmSource: this.normalizeOriginValue(origin?.utm_source),
      utmMedium: this.normalizeOriginValue(origin?.utm_medium),
      utmCampaign: this.normalizeOriginValue(origin?.utm_campaign),
    };
  }

  private normalizeOriginValue(raw?: string) {
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    return value.slice(0, 120);
  }
}
