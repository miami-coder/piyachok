import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { CacheService } from '../../../common/services/cache.service';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  roles?: string[];
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly cache?: CacheService,
    private readonly users?: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUser> {
    // Видалений адміном юзер не може жити зі старим access-токеном.
    if (this.cache) {
      if (this.cache.isConnected()) {
        // Прапор кешується адмін-видаленням; на кожному хіті
        // TTL продовжується (sliding) — вікно не стухає до кінця життя токена.
        const deleted = await this.cache.get(`deleted:${payload.sub}`);
        if (deleted) {
          await this.cache.set(`deleted:${payload.sub}`, true, 960);
          throw new UnauthorizedException('Обліковий запис видалено');
        }
      } else if (this.users) {
        // Redis мертвий: прапор недоступний, тому перевіряємо source-of-truth
        // у БД — deleteMe/softDelete ставлять deletedAt у базі, а не тільки
        // в кеші. Без цього фолбеку видалений юзер ходив би зі старим
        // access-токеном весь час аутагу Redis. Неіснуючий sub — теж 401.
        const user = await this.users.findById(payload.sub).catch(() => null);
        if (!user || user.deletedAt) {
          throw new UnauthorizedException('Обліковий запис видалено');
        }
      }
    }
    return {
      sub: payload.sub,
      email: payload.email,
      roles: payload.roles ?? [],
    };
  }
}
