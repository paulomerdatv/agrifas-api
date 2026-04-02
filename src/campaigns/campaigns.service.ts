import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, Prisma } from '@prisma/client';
import { DiscordLogsService } from '../discord-logs/discord-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveAdminRaffleTimelineStatus,
  isRaffleActiveInScheduleWindow,
} from '../raffles/raffle-schedule.utils';

interface CampaignPayload {
  title?: string;
  slug?: string;
  description?: string | null;
  active?: boolean;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  bannerTitle?: string | null;
  bannerSubtitle?: string | null;
  bannerButtonText?: string | null;
  bannerButtonLink?: string | null;
  couponCode?: string | null;
  featuredRaffleId?: string | null;
  priority?: number;
  campaignType?: string | null;
  imageUrl?: string | null;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogsService: DiscordLogsService,
  ) {}

  async listAdminCampaigns() {
    const now = new Date();
    const campaigns = await this.prisma.campaign.findMany({
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
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return campaigns.map((campaign) =>
      this.toAdminCampaignOutput(campaign, now),
    );
  }

  async getAdminCampaignById(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
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

    if (!campaign) {
      throw new NotFoundException('Campanha nao encontrada.');
    }

    return this.toAdminCampaignOutput(campaign, new Date());
  }

  async createCampaign(input: CampaignPayload, adminUserId?: string) {
    const data = await this.buildCreateData(input);

    const created = await this.prisma.campaign.create({
      data,
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

    void this.discordLogsService.sendAdminLog({
      title: 'Campanha criada',
      description: 'Nova campanha promocional criada no admin.',
      fields: [
        { name: 'campaignId', value: created.id, inline: true },
        { name: 'slug', value: created.slug, inline: true },
        { name: 'active', value: String(created.active), inline: true },
        { name: 'priority', value: created.priority, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return this.toAdminCampaignOutput(created, new Date());
  }

  async updateCampaign(id: string, input: CampaignPayload, adminUserId?: string) {
    const current = await this.prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        slug: true,
      },
    });

    if (!current) {
      throw new NotFoundException('Campanha nao encontrada.');
    }

    const data = await this.buildUpdateData(input, current);
    if (!Object.keys(data).length) {
      throw new BadRequestException('Nenhum campo valido enviado para atualizacao.');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data,
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

    void this.discordLogsService.sendAdminLog({
      title: 'Campanha atualizada',
      description: 'Campanha promocional editada no admin.',
      fields: [
        { name: 'campaignId', value: updated.id, inline: true },
        { name: 'slug', value: updated.slug, inline: true },
        { name: 'active', value: String(updated.active), inline: true },
        { name: 'priority', value: updated.priority, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return this.toAdminCampaignOutput(updated, new Date());
  }

  async deleteCampaign(id: string, adminUserId?: string) {
    const current = await this.prisma.campaign.findUnique({
      where: { id },
      select: { id: true, slug: true, title: true },
    });

    if (!current) {
      throw new NotFoundException('Campanha nao encontrada.');
    }

    await this.prisma.campaign.delete({ where: { id } });

    void this.discordLogsService.sendAdminLog({
      title: 'Campanha removida',
      description: 'Campanha promocional excluida no admin.',
      fields: [
        { name: 'campaignId', value: current.id, inline: true },
        { name: 'slug', value: current.slug, inline: true },
        { name: 'adminId', value: adminUserId || '-', inline: true },
      ],
    });

    return {
      success: true,
      message: 'Campanha excluida com sucesso.',
    };
  }

  async getActivePublicCampaign() {
    const now = new Date();
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        active: true,
        AND: [
          {
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          },
          {
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        ],
      },
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
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    if (!campaign) {
      return null;
    }

    const featuredRaffle =
      campaign.featuredRaffle &&
      isRaffleActiveInScheduleWindow(campaign.featuredRaffle, now)
        ? this.formatRaffleWithTickets(campaign.featuredRaffle)
        : null;

    return {
      ...campaign,
      featuredRaffle,
      featuredRaffleId: featuredRaffle ? campaign.featuredRaffleId : null,
    };
  }

  private toAdminCampaignOutput(campaign: any, now: Date) {
    return {
      ...campaign,
      isPubliclyActive: this.isCampaignPubliclyActive(campaign, now),
      featuredRaffle: campaign.featuredRaffle
        ? {
            ...campaign.featuredRaffle,
            derivedStatus: deriveAdminRaffleTimelineStatus(
              campaign.featuredRaffle,
              now,
            ),
          }
        : null,
    };
  }

  private isCampaignPubliclyActive(campaign: Campaign, now: Date) {
    if (!campaign.active) return false;
    if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) return false;
    if (campaign.endsAt && campaign.endsAt.getTime() <= now.getTime()) return false;
    return true;
  }

  private parseDateOrNull(value: unknown, fieldName: string) {
    if (value === undefined) return undefined;
    if (value === null || String(value).trim() === '') return null;

    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} invalido.`);
    }

    return date;
  }

  private parseIntOrDefault(value: unknown, fallback: number) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return fallback;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException('priority invalido.');
    }

    return Math.round(parsed);
  }

  private normalizeSlug(raw: unknown) {
    const source = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    if (!source) {
      throw new BadRequestException('slug invalido.');
    }

    return source;
  }

  private normalizeText(value: unknown, maxLength: number) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return normalized.slice(0, maxLength);
  }

  private normalizeOptionalText(value: unknown, maxLength: number) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
  }

  private normalizeOptionalLink(value: unknown) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return normalized.slice(0, 500);
  }

  private async resolveCouponCode(rawValue: unknown) {
    const normalized = String(rawValue || '').trim().toUpperCase();
    if (!normalized) return null;

    const exists = await this.prisma.coupon.findUnique({
      where: { code: normalized },
      select: { id: true },
    });

    if (!exists) {
      throw new BadRequestException('couponCode nao corresponde a cupom existente.');
    }

    return normalized;
  }

  private async resolveFeaturedRaffleId(rawValue: unknown) {
    const normalized = String(rawValue || '').trim();
    if (!normalized) return null;

    const exists = await this.prisma.raffle.findUnique({
      where: { id: normalized },
      select: { id: true },
    });

    return exists?.id || null;
  }

  private ensureScheduleConsistency(startsAt?: Date | null, endsAt?: Date | null) {
    if (!startsAt || !endsAt) return;
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('endsAt deve ser maior que startsAt.');
    }
  }

  private async ensureUniqueSlug(slug: string, ignoreCampaignId?: string) {
    const existing = await this.prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) return;
    if (ignoreCampaignId && existing.id === ignoreCampaignId) return;

    throw new BadRequestException('slug ja esta em uso.');
  }

  private async buildCreateData(input: CampaignPayload) {
    const title = this.normalizeText(input.title, 140);
    if (!title) {
      throw new BadRequestException('title e obrigatorio.');
    }

    const slug = this.normalizeSlug(input.slug || input.title);
    await this.ensureUniqueSlug(slug);

    const startsAt = this.parseDateOrNull(input.startsAt, 'startsAt') ?? null;
    const endsAt = this.parseDateOrNull(input.endsAt, 'endsAt') ?? null;
    this.ensureScheduleConsistency(startsAt, endsAt);

    const priority = this.parseIntOrDefault(input.priority, 0);

    const featuredRaffleId = await this.resolveFeaturedRaffleId(
      input.featuredRaffleId,
    );

    return {
      title,
      slug,
      description: this.normalizeOptionalText(input.description, 1000),
      active: Boolean(input.active),
      startsAt,
      endsAt,
      bannerTitle: this.normalizeOptionalText(input.bannerTitle, 160),
      bannerSubtitle: this.normalizeOptionalText(input.bannerSubtitle, 500),
      bannerButtonText: this.normalizeOptionalText(input.bannerButtonText, 70),
      bannerButtonLink: this.normalizeOptionalLink(input.bannerButtonLink),
      couponCode: await this.resolveCouponCode(input.couponCode),
      featuredRaffle: featuredRaffleId
        ? { connect: { id: featuredRaffleId } }
        : undefined,
      priority,
      campaignType: this.normalizeOptionalText(input.campaignType, 70),
      imageUrl: this.normalizeOptionalLink(input.imageUrl),
    } satisfies Prisma.CampaignCreateInput;
  }

  private async buildUpdateData(
    input: CampaignPayload,
    current: {
      id: string;
      startsAt: Date | null;
      endsAt: Date | null;
      slug: string;
    },
  ) {
    const data: Prisma.CampaignUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(input, 'title')) {
      const title = this.normalizeText(input.title, 140);
      if (!title) {
        throw new BadRequestException('title invalido.');
      }
      data.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'slug')) {
      const slug = this.normalizeSlug(input.slug);
      await this.ensureUniqueSlug(slug, current.id);
      data.slug = slug;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
      data.description = this.normalizeOptionalText(input.description, 1000);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'active')) {
      data.active = Boolean(input.active);
    }

    const startsAt = this.parseDateOrNull(input.startsAt, 'startsAt');
    const endsAt = this.parseDateOrNull(input.endsAt, 'endsAt');

    if (startsAt !== undefined) {
      data.startsAt = startsAt;
    }

    if (endsAt !== undefined) {
      data.endsAt = endsAt;
    }

    const effectiveStartsAt =
      startsAt !== undefined ? startsAt : current.startsAt;
    const effectiveEndsAt = endsAt !== undefined ? endsAt : current.endsAt;
    this.ensureScheduleConsistency(effectiveStartsAt, effectiveEndsAt);

    if (Object.prototype.hasOwnProperty.call(input, 'bannerTitle')) {
      data.bannerTitle = this.normalizeOptionalText(input.bannerTitle, 160);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'bannerSubtitle')) {
      data.bannerSubtitle = this.normalizeOptionalText(input.bannerSubtitle, 500);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'bannerButtonText')) {
      data.bannerButtonText = this.normalizeOptionalText(input.bannerButtonText, 70);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'bannerButtonLink')) {
      data.bannerButtonLink = this.normalizeOptionalLink(input.bannerButtonLink);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'couponCode')) {
      data.couponCode = await this.resolveCouponCode(input.couponCode);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'featuredRaffleId')) {
      const featuredRaffleId = await this.resolveFeaturedRaffleId(
        input.featuredRaffleId,
      );
      data.featuredRaffle = featuredRaffleId
        ? { connect: { id: featuredRaffleId } }
        : { disconnect: true };
    }

    if (Object.prototype.hasOwnProperty.call(input, 'priority')) {
      data.priority = this.parseIntOrDefault(input.priority, 0);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'campaignType')) {
      data.campaignType = this.normalizeOptionalText(input.campaignType, 70);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'imageUrl')) {
      data.imageUrl = this.normalizeOptionalLink(input.imageUrl);
    }

    return data;
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
    const reservedNumbers: number[] = reservedOrders.flatMap(
      (o: any) => o.selectedTickets,
    );

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
