import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../rbac/entities/user-role.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenService } from './jwt.service';
import { CacheService } from '../../../common/services/cache.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RoleGrantsService } from '../../rbac/role-grants.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,
    private readonly grants: RoleGrantsService,
    private readonly tokens: TokenService,
    private readonly cache: CacheService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.acceptEula) {
      // 400 (клієнтська помилка валідації), не 409
      throw new BadRequestException('Потрібно прийняти угоду користувача');
    }

    // Юзер + профіль + базова роль — атомарно: провал видачі ролі відкочує
    // і юзера, інакше повторна реєстрація з тим самим email була б 409,
    // а обліковий запис назавжди лишався б без ролі.
    const user = await this.userRoles.manager.transaction(async (em) => {
      const user = await this.users.create(dto, em);

      // Роль 'user' через єдину точку видачі ролей. Відсутність базової
      // ролі — це зламаний стенд, реєстрація не може пройти мовчки
      // (throw всередині транзакції = відкат усього).
      if (!(await this.grants.grant(user.id, 'user', { em }))) {
        throw new InternalServerErrorException(
          'Базову роль не налаштовано — зверніться до адміністрації',
        );
      }
      return user;
    });
    // Подію user_role.added для нового юзера не емітуємо: кешу пермішенів
    // у нього ще не існує, інвалідувати нема чого.

    const roles = await this.getUserRoles(user.id);
    return this.issueTokens(user.id, user.email, roles);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Невірний email або пароль');
    const ok = await this.users.verifyPassword(user, dto.password);
    if (!ok) throw new UnauthorizedException('Невірний email або пароль');
    // Видалення адміном — фінальне: жодного авто-оживання
    // при повторному заході паролем.
    if (user.deletedAt)
      throw new UnauthorizedException('Обліковий запис видалено');
    const roles = await this.getUserRoles(user.id);
    return this.issueTokens(user.id, user.email, roles);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new UnauthorizedException('Невірний refresh token');
    }
    const user = await this.users.findById(payload.sub);
    if (user?.deletedAt)
      throw new UnauthorizedException('Обліковий запис видалено');
    const roles = await this.getUserRoles(user.id);

    // Ротація за атомарним claim: кілька паралельних запитів з одним
    // простроченим access-токеном одночасно пред'являють той самий
    // refresh-токен, а SET NX віддає перемогу рівно одному з них. Переможець
    // ротує пару; решта читають ЇЇ ЖЕ з grace-ключа замість 401 (одноразовий
    // токен, і перевірка get-then-set не атомарна — без claim паралельні
    // запити або пролітали двічі, або отримували 401 і викидались на логін).
    if (
      await this.cache.setIfNotExists(
        `revoked:${refreshToken}`,
        true,
        60 * 60 * 24 * 30,
      )
    ) {
      const issued = this.issueTokens(user.id, user.email, roles);
      // Grace-вікно 60с: паралельні refresh того самого старого токена
      // отримують ідентичну пару. Короткий TTL — reuse поза паралельністю
      // (реальний reuse-кандидат) швидко знову стає 401.
      await this.cache.set(`rotated:${refreshToken}`, issued, 60);
      return issued;
    }

    // Програний claim — переможець ротує пару, віддаємо її саму. Ретраї
    // покривають мікро-вікно між claim переможця і записом grace-ключа
    // (у ньму вже виконуються SELECT юзера і підпис токенів).
    for (let attempt = 0; attempt < 3; attempt++) {
      const rotated = await this.cache.get<
        ReturnType<AuthService['issueTokens']>
      >(`rotated:${refreshToken}`);
      if (rotated) return rotated;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new UnauthorizedException('Refresh token скасований');
  }

  async logout(refreshToken: string) {
    await this.cache.set(`revoked:${refreshToken}`, true, 60 * 60 * 24 * 30);
    // Grace-пару цього токена теж знищуємо: після логауту reuse протягом вікна
    // не має повернути живу пару
    await this.cache.del(`rotated:${refreshToken}`);
  }

  async getRolesForUser(userId: string): Promise<string[]> {
    return this.getUserRoles(userId);
  }

  async issueTokensForUser(sub: string, email: string, roles: string[]) {
    return this.issueTokens(sub, email, roles);
  }

  private async getUserRoles(userId: string): Promise<string[]> {
    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .innerJoin('ur.role', 'r')
      .where('ur.userId = :userId', { userId })
      .select('r.code', 'code')
      .getRawMany<{ code: string }>();
    return rows.map((r) => r.code);
  }

  private issueTokens(sub: string, email: string, roles: string[]) {
    const accessToken = this.tokens.signAccess({ sub, email, roles });
    const refreshToken = this.tokens.signRefresh({ sub });
    return {
      accessToken,
      refreshToken,
      user: { id: sub, email, roles },
    };
  }
}
