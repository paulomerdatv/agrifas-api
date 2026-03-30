import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class SteamAuthGuard extends AuthGuard('steam-openid') {
  getAuthenticateOptions(_context: ExecutionContext) {
    return { session: false };
  }

  handleRequest(err: any, user: any) {
    if (err) {
      return null;
    }

    return user || null;
  }
}
