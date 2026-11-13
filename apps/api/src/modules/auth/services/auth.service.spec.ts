import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { TokenService } from './jwt.service';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../rbac/entities/user-role.entity';
import { RoleGrantsService } from '../../rbac/role-grants.service';
import { CacheService } from '../../../common/services/cache.service';

describe('AuthService', () => {
  let service: AuthService;
  let users: any;
  let userRoles: any;
  let grants: any;
  let tokens: any;
  let cache: any;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    users = {
      create: jest.fn().mockImplementation(async (dto) => ({
        id: 'u-new',
        email: dto.email.toLowerCase(),
        passwordHash: 'hash',
      })),
      findById: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
      findByEmail: jest.fn(),
      verifyPassword: jest.fn(),
    };
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ code: 'user' }]),
    };
    userRoles = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      manager: {
        findOne: jest.fn().mockResolvedValue({ id: 'r-user', code: 'user' }),
        // реєстрація: юзер+роль у транзакції; em віддаємо в колбек як є
        transaction: jest.fn(async (cb: any) => cb((userRoles as any).manager)),
      },
      save: jest.fn().mockResolvedValue(undefined),
    };
    grants = { grant: jest.fn().mockResolvedValue(true) };
    tokens = {
      signAccess: jest.fn().mockReturnValue('access-tok'),
      signRefresh: jest.fn().mockReturnValue('refresh-tok'),
      verifyRefresh: jest.fn().mockReturnValue({ sub: 'u1' }),
    };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      setIfNotExists: jest.fn().mockResolvedValue(true),
    };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        { provide: TokenService, useValue: tokens },
        { provide: UsersService, useValue: users },
        { provide: getRepositoryToken(UserRole), useValue: userRoles },
        { provide: RoleGrantsService, useValue: grants },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('register acceptEula:false → 400 BadRequest', async () => {
    await expect(
      service.register({
        email: 'a@b.com',
        password: 'Password1',
        firstname: 'A',
        lastname: 'B',
        acceptEula: false,
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('register creates user, assigns role via RoleGrantsService, returns tokens', async () => {
    const res = await service.register({
      email: 'A@B.com',
      password: 'Password1',
      firstname: 'A',
      lastname: 'B',
      acceptEula: true,
    });
    expect(users.create).toHaveBeenCalled();
    expect(grants.grant).toHaveBeenCalledWith(
      'u-new',
      'user',
      expect.anything(), // em — транзакція реєстрації
    );
    expect(userRoles.save).not.toHaveBeenCalled();
    expect(res.accessToken).toBe('access-tok');
    expect(res.user.roles).toEqual(['user']);
  });

  it('register без базової ролі → 500 (реєстрація не проходить мовчки)', async () => {
    grants.grant.mockResolvedValueOnce(false);
    await expect(
      service.register({
        email: 'A@B.com',
        password: 'Password1',
        firstname: 'A',
        lastname: 'B',
        acceptEula: true,
      }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('login throws on unknown email', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.login({ email: 'x@y.com', password: 'p' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login throws on bad password', async () => {
    users.findByEmail.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' });
    users.verifyPassword.mockResolvedValueOnce(false);
    await expect(
      service.login({ email: 'a@b.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login returns tokens on success', async () => {
    users.findByEmail.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' });
    users.verifyPassword.mockResolvedValueOnce(true);
    const res = await service.login({
      email: 'a@b.com',
      password: 'Password1',
    });
    expect(res.accessToken).toBe('access-tok');
  });

  // Дефект: soft-видалений (адмін-видалення) акаунт міг логінитесь паролем
  // «мулликом» — без ролей і невидимий у списку користувачів
  it('login soft-видаленого акаунта не оживає, а відкидається 401', async () => {
    users.findByEmail.mockResolvedValueOnce({
      id: 'u-del',
      email: 'a@b.com',
      deletedAt: new Date(),
    });
    users.verifyPassword.mockResolvedValueOnce(true);
    await expect(
      service.login({ email: 'a@b.com', password: 'Password1' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(tokens.signAccess).not.toHaveBeenCalled();
  });

  // Ротація за атомарним claim: скасований токен — це програний SET NX за
  // відсутності grace-пари (не get-перевірка, як раніше)
  it('refresh throws when token revoked', async () => {
    cache.setIfNotExists.mockResolvedValueOnce(false);
    await expect(service.refresh('old')).rejects.toThrow(UnauthorizedException);
  });

  it('refresh rotates token on success', async () => {
    const res = await service.refresh('old');
    expect(res.accessToken).toBe('access-tok');
    expect(res.refreshToken).toBe('refresh-tok');
    expect(cache.setIfNotExists).toHaveBeenCalledWith(
      'revoked:old',
      true,
      expect.any(Number),
    );
    expect(cache.set).toHaveBeenCalledWith(
      'rotated:old',
      expect.objectContaining({ accessToken: 'access-tok' }),
      60,
    );
  });

  it('refresh повертає grace-пару переможця, коли claim програно', async () => {
    cache.setIfNotExists.mockResolvedValueOnce(false);
    const winnersPair = {
      accessToken: 'winner-access',
      refreshToken: 'winner-refresh',
      user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
    };
    cache.get.mockResolvedValueOnce(winnersPair);
    const res = await service.refresh('old');
    expect(res).toEqual(winnersPair);
    expect(tokens.signAccess).not.toHaveBeenCalled();
  });

  it('refresh после програного claim без grace-пари → 401 (reuse поза вікном)', async () => {
    cache.setIfNotExists.mockResolvedValueOnce(false);
    await expect(service.refresh('old')).rejects.toThrow(UnauthorizedException);
  });

  it('logout marks token revoked', async () => {
    await service.logout('r1');
    expect(cache.set).toHaveBeenCalledWith(
      'revoked:r1',
      true,
      expect.any(Number),
    );
  });

  it('logout знищує grace-пару токена', async () => {
    await service.logout('r1');
    expect(cache.del).toHaveBeenCalledWith('rotated:r1');
  });
});

describe('AuthService — видалення юзера фінальне', () => {
  let service: AuthService;
  let users: any;
  let userRoles: any;
  let tokens: any;
  let cache: any;

  beforeEach(async () => {
    users = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      verifyPassword: jest.fn(),
      findById: jest.fn(),
      ensureUserRole: jest.fn().mockResolvedValue(undefined),
    };
    userRoles = {
      save: jest.fn(),
      manager: {
        findOne: jest.fn(),
        transaction: jest.fn(async (cb: any) => cb((userRoles as any).manager)),
      },
    };
    tokens = {
      signAccess: jest.fn().mockReturnValue('access-tok'),
      signRefresh: jest.fn().mockReturnValue('refresh-tok'),
      verifyRefresh: jest.fn().mockReturnValue({ sub: 'u1' }),
    };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      setIfNotExists: jest.fn().mockResolvedValue(true),
    };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: getRepositoryToken(UserRole), useValue: userRoles },
        { provide: RoleGrantsService, useValue: { grant: jest.fn() } },
        { provide: TokenService, useValue: tokens },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('login видаленого юзера → 401 і БЕЗ авто-оживання', async () => {
    users.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      deletedAt: new Date(),
    });
    users.verifyPassword.mockResolvedValueOnce(true);
    await expect(
      service.login({ email: 'a@b.com', password: 'p' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(tokens.signAccess).not.toHaveBeenCalled();
  });

  it('refresh токена видаленого юзера → 401', async () => {
    users.findById.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      deletedAt: new Date(),
    });
    await expect(service.refresh('rt')).rejects.toThrow(UnauthorizedException);
    expect(tokens.signAccess).not.toHaveBeenCalled();
  });

  it('register на email видаленого юзера → 409 (без оживання)', async () => {
    users.create.mockRejectedValueOnce(
      new ConflictException('Користувач з таким email вже існує'),
    );
    await expect(
      service.register({
        email: 'a@b.com',
        password: 'Password1',
        firstname: 'A',
        lastname: 'B',
        acceptEula: true,
      } as any),
    ).rejects.toThrow(ConflictException);
  });
});
