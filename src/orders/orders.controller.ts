import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

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
      throw new NotFoundException('Rifa não encontrada.');
    }

    const totalAmount = selectedTickets.length * raffle.pricePerTicket;
    const trackingOrigin = this.resolveTrackingOrigin(body.origin);

    return this.prisma.order.create({
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
