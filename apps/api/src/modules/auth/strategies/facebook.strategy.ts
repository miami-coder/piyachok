import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { UsersService } from '../../users/users.service';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  private readonly users: UsersService;
  private readonly config: ConfigService;

  constructor(
    users: UsersService,
    // OAuth-варси приходять з валідованого конфіга; дефолти (включно з
    // callback-URL) задані в EnvVars, тому тут без фоллбек-констант.
    config: ConfigService,
  ) {
    const clientID = config.get<string>('FACEBOOK_APP_ID');
    const clientSecret = config.get<string>('FACEBOOK_APP_SECRET');
    if (!clientID || !clientSecret) {
      super({
        clientID: 'placeholder',
        clientSecret: 'placeholder',
        callbackURL: config.getOrThrow<string>('FACEBOOK_CALLBACK_URL'),
        profileFields: ['id', 'emails', 'name', 'displayName'],
      });
    } else {
      super({
        clientID,
        clientSecret,
        callbackURL: config.getOrThrow<string>('FACEBOOK_CALLBACK_URL'),
        profileFields: ['id', 'emails', 'name', 'displayName'],
      });
    }
    this.users = users;
    this.config = config;
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    // Типізований done (замість any-підпису у VerifyFunction пасажпорта):
    // стратегія повертає підзапис { id, email } або помилку.
    done: (error: Error | null, user?: { id: string; email: string }) => void,
  ) {
    const email =
      profile.emails?.[0]?.value ?? `${profile.id}@facebook.placeholder`;
    const firstname = profile.name?.givenName ?? profile.displayName ?? 'User';
    const lastname = profile.name?.familyName ?? '';
    const user = await this.users.findOrCreateOAuthUser(
      email,
      'facebook',
      profile.id,
      { firstname, lastname },
    );
    done(null, { id: user.id, email: user.email });
  }
}
