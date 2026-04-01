import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SteamAuthGuard } from './guards/steam-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto);
  }

  @UseGuards(SteamAuthGuard)
  @Get('steam')
  steamLogin() {
    return;
  }

  @UseGuards(SteamAuthGuard)
  @Get('steam/return')
  async steamReturn(@Req() req: any, @Res() res: Response) {
    if (!req?.user) {
      return res.redirect(this.authService.getSteamFailureRedirectUrl());
    }

    try {
      const authResult = await this.authService.loginWithSteamProfile(req.user);
      return res.redirect(
        this.authService.getSteamSuccessRedirectUrl(authResult.access_token),
      );
    } catch {
      return res.redirect(this.authService.getSteamFailureRedirectUrl());
    }
  }

  @Get('steam/failure')
  steamFailure(@Res() res: Response) {
    return res.redirect(this.authService.getSteamFailureRedirectUrl());
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: any) {
    return this.prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        steamId: true,
        steamAvatar: true,
        provider: true,
        twoFactorEnabled: true,
        twoFactorMethod: true,
        twoFactorEmailVerifiedAt: true,
        isBlocked: true,
        blockedAt: true,
        createdAt: true,
      },
    });
  }
}
