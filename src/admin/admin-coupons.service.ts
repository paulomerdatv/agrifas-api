import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CouponType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ListCouponsInput {
  search?: string;
  active?: string;
}

interface CreateCouponInput {
  code?: string;
  type?: CouponType | string;
  value?: number;
  active?: boolean;
  usageLimit?: number | null;
  expiresAt?: string | null;
}

interface UpdateCouponInput {
  code?: string;
  type?: CouponType | string;
  value?: number;
  active?: boolean;
  usageLimit?: number | null;
  expiresAt?: string | null;
}

@Injectable()
export class AdminCouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCoupons(input: ListCouponsInput) {
    const where: Prisma.CouponWhereInput = {};
    const search = (input.search || '').trim().toUpperCase();

    if (search) {
      where.code = { contains: search, mode: 'insensitive' };
    }

    if (typeof input.active === 'string' && input.active.trim()) {
      const normalized = input.active.trim().toLowerCase();
      if (normalized === 'true') where.active = true;
      if (normalized === 'false') where.active = false;
    }

    const coupons = await this.prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return coupons.map((coupon) => this.toCouponOutput(coupon));
  }

  async createCoupon(input: CreateCouponInput) {
    const code = this.normalizeCode(input.code);
    const type = this.normalizeType(input.type);
    const value = this.normalizeValue(input.value, type);
    const usageLimit = this.normalizeUsageLimit(input.usageLimit);
    const expiresAt = this.normalizeExpiresAt(input.expiresAt);
    const active = input.active ?? true;

    try {
      const created = await this.prisma.coupon.create({
        data: {
          code,
          type,
          value,
          active,
          usageLimit,
          expiresAt,
        },
      });

      return this.toCouponOutput(created);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('Ja existe um cupom com este codigo.');
      }
      throw error;
    }
  }

  async updateCoupon(couponId: string, input: UpdateCouponInput) {
    const current = await this.prisma.coupon.findUnique({
      where: { id: couponId },
    });

    if (!current) {
      throw new NotFoundException('Cupom nao encontrado.');
    }

    const nextType = input.type ? this.normalizeType(input.type) : current.type;
    const nextValue =
      typeof input.value === 'number' ? this.normalizeValue(input.value, nextType) : current.value;
    const nextCode = typeof input.code === 'string' ? this.normalizeCode(input.code) : current.code;
    const nextUsageLimit =
      input.usageLimit === undefined
        ? current.usageLimit
        : this.normalizeUsageLimit(input.usageLimit);
    const nextExpiresAt =
      input.expiresAt === undefined
        ? current.expiresAt
        : this.normalizeExpiresAt(input.expiresAt);
    const nextActive =
      typeof input.active === 'boolean' ? input.active : current.active;

    if (nextUsageLimit !== null && nextUsageLimit < current.usedCount) {
      throw new BadRequestException(
        `usageLimit nao pode ser menor que o total ja utilizado (${current.usedCount}).`,
      );
    }

    try {
      const updated = await this.prisma.coupon.update({
        where: { id: couponId },
        data: {
          code: nextCode,
          type: nextType,
          value: nextValue,
          usageLimit: nextUsageLimit,
          expiresAt: nextExpiresAt,
          active: nextActive,
        },
      });

      return this.toCouponOutput(updated);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('Ja existe um cupom com este codigo.');
      }
      throw error;
    }
  }

  async setCouponActive(couponId: string, active: boolean) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: { id: true },
    });

    if (!coupon) {
      throw new NotFoundException('Cupom nao encontrado.');
    }

    const updated = await this.prisma.coupon.update({
      where: { id: couponId },
      data: { active },
    });

    return this.toCouponOutput(updated);
  }

  private normalizeCode(raw?: string) {
    const code = (raw || '').trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('Codigo do cupom e obrigatorio.');
    }
    if (code.length < 3) {
      throw new BadRequestException('Codigo do cupom deve ter ao menos 3 caracteres.');
    }
    if (code.length > 40) {
      throw new BadRequestException('Codigo do cupom deve ter no maximo 40 caracteres.');
    }

    return code;
  }

  private normalizeType(raw?: CouponType | string): CouponType {
    const type = String(raw || '').trim().toUpperCase();
    if (type === CouponType.FIXED) return CouponType.FIXED;
    if (type === CouponType.PERCENTAGE) return CouponType.PERCENTAGE;
    throw new BadRequestException('Tipo de cupom invalido. Use FIXED ou PERCENTAGE.');
  }

  private normalizeValue(raw: number | undefined, type: CouponType) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('Valor do cupom deve ser maior que zero.');
    }

    if (type === CouponType.PERCENTAGE && value > 100) {
      throw new BadRequestException('Cupom percentual nao pode ultrapassar 100%.');
    }

    return Number(value.toFixed(2));
  }

  private normalizeUsageLimit(raw?: number | null) {
    if (raw === null) return null;
    if (raw === undefined) return null;
    const usageLimit = Number(raw);
    if (!Number.isInteger(usageLimit) || usageLimit < 1) {
      throw new BadRequestException('usageLimit deve ser inteiro maior ou igual a 1.');
    }
    return usageLimit;
  }

  private normalizeExpiresAt(raw?: string | null) {
    if (raw === null) return null;
    if (raw === undefined) return null;

    const value = raw.trim();
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('expiresAt invalido.');
    }
    return parsed;
  }

  private toCouponOutput(coupon: any) {
    const remainingUses =
      typeof coupon.usageLimit === 'number'
        ? Math.max(0, coupon.usageLimit - coupon.usedCount)
        : null;

    return {
      ...coupon,
      remainingUses,
    };
  }
}
