import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  SteamOpenIdStrategy,
  SteamOpenIdStrategyOptions,
} from 'passport-steam-openid';

@Injectable()
export class SteamStrategy extends PassportStrategy(
  SteamOpenIdStrategy,
  'steam-openid',
) {
  constructor() {
    const steamRealm = (process.env.STEAM_REALM || 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
    const returnURL =
      process.env.STEAM_RETURN_URL || `${steamRealm}/auth/steam/return`;
    const steamApiKey = (process.env.STEAM_API_KEY || '').trim();

    const options: SteamOpenIdStrategyOptions = steamApiKey
      ? {
          profile: true,
          apiKey: steamApiKey,
          returnURL,
          maxNonceTimeDelay: 60,
        }
      : {
          profile: false,
          returnURL,
          maxNonceTimeDelay: 60,
        };

    super(options);
  }

  validate(_req: any, _identifier: string, profile: any) {
    return profile;
  }
}
