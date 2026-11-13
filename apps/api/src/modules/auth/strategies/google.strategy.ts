import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { UsersService } from '../../users/users.service';

interface GoogleProfile {
  id: string;
  displayName?: string;
  name?: { givenName?: string; familyName?: string };
  emails?: { value: string }[];
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly users: UsersService;
  private readonly config: ConfigService;

  constructor(
    users: UsersService,
    // OAuth-варси приходять з валідованого конфіга; дефолти (включно з
    // callback-URL) задані в EnvVars, тому тут без фоллбек-констант.
    config: ConfigService,
  ) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientID || !clientSecret) {
      // Пропускаємо реєстрацію стратегії, якщо OAuth не налаштований
      super({
        clientID: 'placeholder',
        clientSecret: 'placeholder',
        callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
        scope: ['email', 'profile'],
      });
    } else {
      super({
        clientID,
        clientSecret,
        callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
        scope: ['email', 'profile'],
      });
    }
    this.users = users;
    this.config = config;
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ) {
    const email = profile.emails?.[0]?.value;
    if (!email)
      return done(new Error('Email not provided by Google'), undefined);
    const firstname = profile.name?.givenName ?? profile.displayName ?? 'User';
    const lastname = profile.name?.familyName ?? '';
    const user = await this.users.findOrCreateOAuthUser(
      email,
      'google',
      profile.id,
      { firstname, lastname },
    );
    done(null, { id: user.id, email: user.email });
  }
}
