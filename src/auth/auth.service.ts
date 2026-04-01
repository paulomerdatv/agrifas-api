import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { DiscordLogsService } from '../discord-logs/discord-logs.service';

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
    private readonly discordLogsService: DiscordLogsService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha de cadastro',
        description: 'Tentativa de cadastro com e-mail ja utilizado.',
        fields: [{ name: 'email', value: this.maskEmail(dto.email) }],
      });
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

    void this.discordLogsService.sendAuthLog({
      title: 'Novo cadastro',
      description: 'Conta criada com sucesso.',
      fields: [
        { name: 'userId', value: user.id, inline: true },
        { name: 'provider', value: user.provider || 'LOCAL', inline: true },
        { name: 'ref', value: user.refCode || '-', inline: true },
        { name: 'utm_source', value: user.utmSource || '-', inline: true },
      ],
    });

    return this.generateToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha de login',
        description: 'Usuario nao encontrado para o e-mail informado.',
        fields: [{ name: 'email', value: this.maskEmail(dto.email) }],
      });
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    if (user.isBlocked) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha de login',
        description: 'Conta bloqueada tentou autenticar.',
        fields: [
          { name: 'userId', value: user.id, inline: true },
          { name: 'email', value: this.maskEmail(user.email), inline: true },
        ],
      });
      throw new UnauthorizedException('Conta bloqueada. Entre em contato com o suporte.');
    }

    if (!user.passwordHash) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha de login',
        description: 'Conta social tentou login por senha.',
        fields: [
          { name: 'userId', value: user.id, inline: true },
          { name: 'provider', value: user.provider || '-', inline: true },
        ],
      });
      throw new UnauthorizedException(
        'Esta conta usa login social. Utilize o login com Steam.',
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha de login',
        description: 'Senha invalida informada.',
        fields: [
          { name: 'userId', value: user.id, inline: true },
          { name: 'email', value: this.maskEmail(user.email), inline: true },
        ],
      });
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    void this.discordLogsService.sendAuthLog({
      title: 'Login realizado',
      description: 'Autenticacao por e-mail/senha concluida com sucesso.',
      fields: [
        { name: 'userId', value: user.id, inline: true },
        { name: 'provider', value: user.provider || 'LOCAL', inline: true },
      ],
    });

    if (user.role === 'ADMIN') {
      void this.discordLogsService.sendAdminLog({
        title: 'Admin logou',
        description: 'Login de administrador realizado com sucesso.',
        fields: [
          { name: 'adminId', value: user.id, inline: true },
          { name: 'provider', value: user.provider || 'LOCAL', inline: true },
        ],
      });
    }

    return this.generateToken(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = this.normalizeEmail(dto?.email);
    this.assertPasswordConfirmation(dto?.newPassword, dto?.confirmPassword);

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha ao recuperar senha',
        description: 'Tentativa de redefinicao sem conta vinculada ao e-mail.',
        fields: [{ name: 'email', value: this.maskEmail(email) }],
      });
      throw new NotFoundException('Nao encontramos uma conta com esse e-mail.');
    }

    if (user.isBlocked) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha ao recuperar senha',
        description: 'Conta bloqueada tentou redefinir senha.',
        fields: [
          { name: 'userId', value: user.id, inline: true },
          { name: 'email', value: this.maskEmail(email), inline: true },
        ],
      });
      throw new UnauthorizedException(
        'Conta bloqueada. Entre em contato com o suporte.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    void this.discordLogsService.sendAuthLog({
      title: 'Senha redefinida',
      description: 'Senha alterada via fluxo de recuperacao.',
      fields: [
        { name: 'userId', value: user.id, inline: true },
        { name: 'email', value: this.maskEmail(email), inline: true },
      ],
    });

    return {
      message: 'Senha atualizada com sucesso. Faca login com a nova senha.',
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    this.assertPasswordConfirmation(dto?.newPassword, dto?.confirmPassword);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Sessao invalida. Faca login novamente.');
    }

    if (user.isBlocked) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha ao trocar senha',
        description: 'Conta bloqueada tentou trocar senha.',
        fields: [{ name: 'userId', value: user.id }],
      });
      throw new UnauthorizedException(
        'Conta bloqueada. Entre em contato com o suporte.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    void this.discordLogsService.sendAuthLog({
      title: 'Senha alterada',
      description: 'Usuario alterou a propria senha na area de perfil.',
      fields: [
        { name: 'userId', value: user.id, inline: true },
        { name: 'email', value: this.maskEmail(user.email), inline: true },
      ],
    });

    if (user.role === 'ADMIN') {
      void this.discordLogsService.sendAdminLog({
        title: 'Admin alterou senha',
        description: 'Administrador alterou a senha na area de perfil.',
        fields: [{ name: 'adminId', value: user.id }],
      });
    }

    return { message: 'Senha alterada com sucesso.' };
  }

  async loginWithSteamProfile(profileInput: SteamOpenIdProfileInput) {
    const steamId = String(profileInput?.steamid || '').trim();
    if (!steamId) {
      void this.discordLogsService.sendAuthLog({
        title: 'Falha de login Steam',
        description: 'Retorno Steam sem steamId valido.',
      });
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
          void this.discordLogsService.sendAuthLog({
            title: 'Falha de login Steam',
            description: 'Conta bloqueada tentou autenticar via Steam.',
            fields: [
              { name: 'userId', value: existingUserBySteamEmail.id, inline: true },
              { name: 'steamId', value: this.maskSteamId(steamId), inline: true },
            ],
          });
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
        void this.discordLogsService.sendAuthLog({
          title: 'Falha de login Steam',
          description: 'Conta bloqueada tentou autenticar via Steam.',
          fields: [
            { name: 'userId', value: user.id, inline: true },
            { name: 'steamId', value: this.maskSteamId(steamId), inline: true },
          ],
        });
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

    void this.discordLogsService.sendAuthLog({
      title: 'Login Steam realizado',
      description: 'Autenticacao via Steam concluida com sucesso.',
      fields: [
        { name: 'userId', value: user.id, inline: true },
        { name: 'steamId', value: this.maskSteamId(steamId), inline: true },
        { name: 'provider', value: 'STEAM', inline: true },
      ],
    });

    if (user.role === 'ADMIN') {
      void this.discordLogsService.sendAdminLog({
        title: 'Admin logou via Steam',
        description: 'Login de administrador via Steam concluido com sucesso.',
        fields: [
          { name: 'adminId', value: user.id, inline: true },
          { name: 'steamId', value: this.maskSteamId(steamId), inline: true },
          { name: 'provider', value: 'STEAM', inline: true },
        ],
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
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
        twoFactorMethod: user.twoFactorMethod || null,
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

  private normalizeEmail(email?: string | null) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      throw new BadRequestException('Informe um e-mail valido.');
    }
    return normalized;
  }

  private assertPasswordConfirmation(
    newPassword?: string,
    confirmPassword?: string,
  ) {
    const normalizedNewPassword = String(newPassword || '');
    const normalizedConfirmPassword = String(confirmPassword || '');

    if (normalizedNewPassword.length < 6) {
      throw new BadRequestException(
        'A nova senha deve ter no minimo 6 caracteres.',
      );
    }

    if (normalizedConfirmPassword.length < 6) {
      throw new BadRequestException(
        'A confirmacao da senha deve ter no minimo 6 caracteres.',
      );
    }

    if (normalizedNewPassword !== normalizedConfirmPassword) {
      throw new BadRequestException('As senhas nao conferem.');
    }
  }

  // Preparacao para futura validacao por codigo enviado via e-mail (2FA / recuperacao).
  // O envio por API de e-mail sera plugado em uma etapa futura usando o valor retornado em `rawCode`.
  private async createFutureSecurityCode(
    userId: string,
    purpose: 'PASSWORD_RESET' | 'TWO_FACTOR_EMAIL',
  ) {
    const rawCode = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(rawCode, 10);
    const ttlMinutes = Number(process.env.EMAIL_SECURITY_CODE_TTL_MINUTES || 10);
    const expiresAt = new Date(Date.now() + Math.max(1, ttlMinutes) * 60 * 1000);

    await this.prisma.userSecurityCode.create({
      data: {
        userId,
        purpose,
        codeHash,
        expiresAt,
      },
    });

    return {
      rawCode,
      expiresAt,
      purpose,
    };
  }

  private maskEmail(email?: string | null) {
    if (!email) return '-';
    const normalized = email.trim().toLowerCase();
    const [local, domain] = normalized.split('@');
    if (!local || !domain) return normalized;
    const visible = local.slice(0, 2);
    return `${visible}***@${domain}`;
  }

  private maskSteamId(steamId?: string | null) {
    if (!steamId) return '-';
    const normalized = steamId.trim();
    if (normalized.length <= 8) return normalized;
    return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
  }
}

