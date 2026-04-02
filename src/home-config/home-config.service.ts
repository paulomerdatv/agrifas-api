import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveAdminRaffleTimelineStatus,
  isRaffleActiveInScheduleWindow,
} from '../raffles/raffle-schedule.utils';

type HomeConfigPayload = {
  heroTitle?: string;
  heroSubtitle?: string;
  heroButtonText?: string;
  heroButtonLink?: string;
  topNoticeText?: string | null;
  promoTitle?: string;
  promoSubtitle?: string;
  promoButtonText?: string;
  promoButtonLink?: string;
  featuredRaffleId?: string | null;
  heroBackgroundImage?: string | null;
  promoImage?: string | null;
};

@Injectable()
export class HomeConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getAdminConfig() {
    const config = await this.prisma.homeConfig.findUnique({
      where: { id: 'default' },
      include: {
        featuredRaffle: {
          select: {
            id: true,
            title: true,
            image: true,
            status: true,
            publishAt: true,
            endAt: true,
          },
        },
      },
    });

    if (!config) {
      return this.getFallbackConfig();
    }

    const now = new Date();
    return {
      ...config,
      featuredRaffle: config.featuredRaffle
        ? {
            ...config.featuredRaffle,
            derivedStatus: deriveAdminRaffleTimelineStatus(
              config.featuredRaffle,
              now,
            ),
          }
        : null,
    };
  }

  async getPublicConfig() {
    const config = await this.prisma.homeConfig.findUnique({
      where: { id: 'default' },
      include: {
        featuredRaffle: {
          include: {
            orders: {
              select: {
                selectedTickets: true,
                status: true,
                provider: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const fallback = this.getFallbackConfig();
    if (!config) {
      return fallback;
    }

    const now = new Date();
    const featuredRaffle =
      config.featuredRaffle &&
      isRaffleActiveInScheduleWindow(config.featuredRaffle, now)
        ? this.formatRaffleWithTickets(config.featuredRaffle)
        : null;

    return {
      ...fallback,
      ...config,
      featuredRaffle,
      featuredRaffleId: featuredRaffle ? config.featuredRaffleId : null,
    };
  }

  async updateConfig(input: HomeConfigPayload) {
    const updateData: Record<string, string | null> = {};

    if (Object.prototype.hasOwnProperty.call(input, 'heroTitle')) {
      updateData.heroTitle = this.normalizeText(input.heroTitle, 140);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'heroSubtitle')) {
      updateData.heroSubtitle = this.normalizeText(input.heroSubtitle, 600);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'heroButtonText')) {
      updateData.heroButtonText = this.normalizeText(input.heroButtonText, 70);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'heroButtonLink')) {
      updateData.heroButtonLink = this.normalizeLink(input.heroButtonLink);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'topNoticeText')) {
      updateData.topNoticeText = this.normalizeOptionalText(input.topNoticeText, 220);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'promoTitle')) {
      updateData.promoTitle = this.normalizeText(input.promoTitle, 140);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'promoSubtitle')) {
      updateData.promoSubtitle = this.normalizeText(input.promoSubtitle, 400);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'promoButtonText')) {
      updateData.promoButtonText = this.normalizeText(input.promoButtonText, 70);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'promoButtonLink')) {
      updateData.promoButtonLink = this.normalizeLink(input.promoButtonLink);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'heroBackgroundImage')) {
      updateData.heroBackgroundImage = this.normalizeOptionalLink(
        input.heroBackgroundImage,
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, 'promoImage')) {
      updateData.promoImage = this.normalizeOptionalLink(input.promoImage);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'featuredRaffleId')) {
      const incomingFeaturedId = String(input.featuredRaffleId || '').trim();
      if (!incomingFeaturedId) {
        updateData.featuredRaffleId = null;
      } else {
        const exists = await this.prisma.raffle.findUnique({
          where: { id: incomingFeaturedId },
          select: { id: true },
        });
        updateData.featuredRaffleId = exists?.id || null;
      }
    }

    const fallback = this.getFallbackConfig();
    const upserted = await this.prisma.homeConfig.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        heroTitle: updateData.heroTitle ?? fallback.heroTitle,
        heroSubtitle: updateData.heroSubtitle ?? fallback.heroSubtitle,
        heroButtonText: updateData.heroButtonText ?? fallback.heroButtonText,
        heroButtonLink: updateData.heroButtonLink ?? fallback.heroButtonLink,
        topNoticeText:
          updateData.topNoticeText === undefined
            ? fallback.topNoticeText
            : updateData.topNoticeText,
        promoTitle: updateData.promoTitle ?? fallback.promoTitle,
        promoSubtitle: updateData.promoSubtitle ?? fallback.promoSubtitle,
        promoButtonText: updateData.promoButtonText ?? fallback.promoButtonText,
        promoButtonLink: updateData.promoButtonLink ?? fallback.promoButtonLink,
        featuredRaffleId:
          updateData.featuredRaffleId === undefined
            ? fallback.featuredRaffleId
            : updateData.featuredRaffleId,
        heroBackgroundImage:
          updateData.heroBackgroundImage === undefined
            ? fallback.heroBackgroundImage
            : updateData.heroBackgroundImage,
        promoImage:
          updateData.promoImage === undefined
            ? fallback.promoImage
            : updateData.promoImage,
      },
      update: updateData,
      include: {
        featuredRaffle: {
          select: {
            id: true,
            title: true,
            image: true,
            status: true,
            publishAt: true,
            endAt: true,
          },
        },
      },
    });

    const now = new Date();
    return {
      ...upserted,
      featuredRaffle: upserted.featuredRaffle
        ? {
            ...upserted.featuredRaffle,
            derivedStatus: deriveAdminRaffleTimelineStatus(
              upserted.featuredRaffle,
              now,
            ),
          }
        : null,
    };
  }

  private getFallbackConfig() {
    return {
      id: 'default',
      heroTitle: 'Rifas de skins CS2 com pagamento PIX instantaneo',
      heroSubtitle:
        'Visual moderno, fluxo rapido e transparencia real: escolha suas cotas, pague em PIX e acompanhe o progresso da rifa em tempo real.',
      heroButtonText: 'Explorar Rifas',
      heroButtonLink: '/raffles',
      topNoticeText: 'Pagamento PIX com confirmacao automatica e suporte ao vivo.',
      promoTitle: 'Participe com confianca na AGrifas',
      promoSubtitle:
        'Acompanhe o andamento das rifas, historico de pedidos e ultimos vencedores em tempo real.',
      promoButtonText: 'Como Funciona',
      promoButtonLink: '/about',
      featuredRaffleId: null,
      heroBackgroundImage: null,
      promoImage: null,
      featuredRaffle: null,
    };
  }

  private normalizeText(value: unknown, maxLength: number) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }
    return normalized.slice(0, maxLength);
  }

  private normalizeOptionalText(value: unknown, maxLength: number) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
  }

  private normalizeLink(value: unknown) {
    const normalized = String(value || '').trim();
    if (!normalized) return '/';
    return normalized.slice(0, 500);
  }

  private normalizeOptionalLink(value: unknown) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return normalized.slice(0, 500);
  }

  private formatRaffleWithTickets(raffle: any) {
    const paidOrders =
      raffle.orders?.filter((o: any) => o.status === 'PAID') || [];

    const reservedOrders =
      raffle.orders?.filter((o: any) => {
        if (o.status !== 'PENDING') return false;

        if (o.provider === 'ADMIN_RESERVE') return true;

        const createdAt = new Date(o.createdAt).getTime();
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        return createdAt >= tenMinutesAgo;
      }) || [];

    const soldNumbers: number[] = paidOrders.flatMap((o: any) => o.selectedTickets);
    const reservedNumbers: number[] = reservedOrders.flatMap((o: any) => o.selectedTickets);

    const tickets = Array.from({ length: raffle.totalTickets }, (_, i) => {
      const number = i + 1;
      let status = 'available';

      if (soldNumbers.includes(number)) {
        status = 'sold';
      } else if (reservedNumbers.includes(number)) {
        status = 'reserved';
      }

      return { number, status };
    });

    return {
      ...raffle,
      tickets,
      soldTickets: [...soldNumbers, ...reservedNumbers],
      soldCount: soldNumbers.length,
      reservedCount: reservedNumbers.length,
    };
  }
}
