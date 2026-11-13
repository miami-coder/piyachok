import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwt, type JwtSignOptions } from '@nestjs/jwt';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: NestJwt,
    // Секрети та TTL приходять з валідованого конфіга: EnvVars гарантує
    // існування секретів (MinLength(16)) і дефолти TTL ('15m'/'30d').
    private readonly config: ConfigService,
  ) {}

  signAccess(payload: { sub: string; email: string; roles: string[] }): string {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>(
        'JWT_ACCESS_TTL',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  signRefresh(payload: { sub: string }): string {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>(
        'JWT_REFRESH_TTL',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  verifyAccess(token: string): { sub: string; email: string; roles: string[] } {
    return this.jwt.verify(token, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  verifyRefresh(token: string): { sub: string } {
    return this.jwt.verify(token, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
    });
  }
}
