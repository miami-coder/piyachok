import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { UsersService } from '../../users/users.service';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  private readonly users: UsersService;

  constructor(users: UsersService) {
    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
      super({
        clientID: 'placeholder',
        clientSecret: 'placeholder',
        callbackURL:
          process.env.FACEBOOK_CALLBACK_URL ??
          'http://localhost:3000/api/v1/auth/facebook/callback',
        profileFields: ['id', 'emails', 'name', 'displayName'],
      });
    } else {
      super({
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL!,
        profileFields: ['id', 'emails', 'name', 'displayName'],
      });
    }
    this.users = users;
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
