import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto, LoginDto } from './dto/auth.dto';

interface SteamOpenIdProfileInput {
  steamid?: string;
  personaname?: string;
  avatar?: string;
  avatarmedium?: string;
  avatarfull?: string;
}

interface TrackingOriginData {
  refCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('Este e-mail ja esta em uso.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const trackingOrigin = this.normalizeTrackingOrigin(dto);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash,
        provider: 'LOCAL',
        refCode: trackingOrigin.refCode,
        utmSource: trackingOrigin.utmSource,
        utmMedium: trackingOrigin.utmMedium,
        utmCampaign: trackingOrigin.utmCampaign,
      },
    });

    return this.generateToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    if (user.isBlocked) {
      throw new UnauthorizedException('Conta bloqueada. Entre em contato com o suporte.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Esta conta usa login social. Utilize o login com Steam.',
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    return this.generateToken(user);
  }

  async loginWithSteamProfile(profileInput: SteamOpenIdProfileInput) {
    const steamId = String(profileInput?.steamid || '').trim();
    if (!steamId) {
      throw new UnauthorizedException('SteamID invalido no retorno da Steam.');
    }

    const steamDisplayName = (profileInput.personaname || '').trim();
    const defaultName = `Steam User ${steamId.slice(-6)}`;
    const userName = steamDisplayName || defaultName;
    const steamAvatar =
      (profileInput.avatarfull || '').trim() ||
      (profileInput.avatarmedium || '').trim() ||
      (profileInput.avatar || '').trim() ||
      null;
    const generatedEmail = `steam_${steamId}@steam.agrifas.local`;

    let user = await this.prisma.user.findUnique({
      where: { steamId },
    });

    if (!user) {
      const existingUserBySteamEmail = await this.prisma.user.findUnique({
        where: { email: generatedEmail },
      });

      if (existingUserBySteamEmail && !existingUserBySteamEmail.steamId) {
        if (existingUserBySteamEmail.isBlocked) {
          throw new UnauthorizedException(
            'Conta bloqueada. Entre em contato com o suporte.',
          );
        }

        user = await this.prisma.user.update({
          where: { id: existingUserBySteamEmail.id },
          data: {
            steamId,
            steamAvatar,
            provider: 'STEAM',
            name: steamDisplayName || existingUserBySteamEmail.name,
          },
        });
      } else {
        const randomPassword = `steam:${steamId}:${Date.now()}`;
        const passwordHash = await bcrypt.hash(randomPassword, 10);

        user = await this.prisma.user.create({
          data: {
            name: userName,
            email: generatedEmail,
            passwordHash,
            steamId,
            steamAvatar,
            provider: 'STEAM',
          },
        });
      }
    } else {
      if (user.isBlocked) {
        throw new UnauthorizedException(
          'Conta bloqueada. Entre em contato com o suporte.',
        );
      }

      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          name: steamDisplayName || user.name,
          steamAvatar: steamAvatar || user.steamAvatar,
          provider: 'STEAM',
        },
      });
    }

    return this.generateToken(user);
  }

  getSteamSuccessRedirectUrl(accessToken: string) {
    const frontendUrl = this.getFrontendBaseUrl();
    return `${frontendUrl}?token=${encodeURIComponent(accessToken)}`;
  }

  getSteamFailureRedirectUrl(reason = 'steam_auth_failed') {
    const frontendUrl = this.getFrontendBaseUrl();
    return `${frontendUrl}?authError=${encodeURIComponent(reason)}`;
  }

  private getFrontendBaseUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(
      /\/+$/,
      '',
    );
  }

  private generateToken(user: any) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        steamId: user.steamId || null,
        steamAvatar: user.steamAvatar || null,
        provider: user.provider || null,
        isBlocked: user.isBlocked || false,
      },
    };
  }

  private normalizeTrackingOrigin(input: {
    ref?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  }): TrackingOriginData {
    return {
      refCode: this.normalizeOriginValue(input?.ref),
      utmSource: this.normalizeOriginValue(input?.utm_source),
      utmMedium: this.normalizeOriginValue(input?.utm_medium),
      utmCampaign: this.normalizeOriginValue(input?.utm_campaign),
    };
  }

  private normalizeOriginValue(raw?: string) {
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    return value.slice(0, 120);
  }
}
