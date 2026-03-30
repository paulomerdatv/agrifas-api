import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'agrifas_super_secret_jwt_key_2026',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        isBlocked: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario nao encontrado.');
    }

    if (user.isBlocked) {
      throw new UnauthorizedException('Conta bloqueada.');
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
