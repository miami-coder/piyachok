import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const SECRET = 'a'.repeat(40);

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    strategy = new JwtStrategy();
  });

  it('validate returns user from token payload', async () => {
    const user = await strategy.validate({
      sub: 'u1',
      email: 'a@b.com',
      roles: ['user'],
    });
    expect(user.sub).toBe('u1');
    expect(user.roles).toEqual(['user']);
  });

  it('validate defaults roles to []', async () => {
    const user = await strategy.validate({ sub: 'u1', email: 'a@b.com' });
    expect(user.roles).toEqual([]);
  });
});

describe('JwtStrategy — видалений юзер (Redis живий)', () => {
  const SECRET = 'b'.repeat(40);
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  it('cache deleted:true → UnauthorizedException + TTL прапора продовжується (sliding 960)', async () => {
    const cache = {
      isConnected: jest.fn().mockReturnValue(true),
      get: jest.fn().mockResolvedValue(true),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const strategy = new JwtStrategy(cache as any);
    await expect(
      strategy.validate({ sub: 'u-del', email: 'a@b.com', roles: ['user'] }),
    ).rejects.toThrow(UnauthorizedException);
    expect(cache.set).toHaveBeenCalledWith('deleted:u-del', true, 960);
  });

  it('cache miss → користувач проходить', async () => {
    const cache = {
      isConnected: jest.fn().mockReturnValue(true),
      get: jest.fn().mockResolvedValue(null),
    };
    const strategy = new JwtStrategy(cache as any);
    const user = await strategy.validate({
      sub: 'u-ok',
      email: 'a@b.com',
      roles: ['user'],
    });
    expect(user.sub).toBe('u-ok');
  });
});

describe('JwtStrategy — Redis мертвий: fallback на БД', () => {
  const SECRET = 'c'.repeat(40);
  let users: {
    findById: jest.Mock;
  };

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    users = { findById: jest.fn() };
  });

  const strategy = () => {
    const cache = {
      isConnected: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      set: jest.fn(),
    };
    return { cache, strategy: new JwtStrategy(cache as any, users as any) };
  };

  it('deletedAt у БД → 401 навіть без прапора кешу', async () => {
    users.findById.mockResolvedValue({ id: 'u-del', deletedAt: new Date() });
    const { cache, strategy: s } = strategy();
    await expect(s.validate({ sub: 'u-del', email: 'a@b.com' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('юзер живий і Redis мертвий → проходить через БД-фолбек', async () => {
    users.findById.mockResolvedValue({ id: 'u-ok', deletedAt: null });
    const { cache, strategy: s } = strategy();
    const user = await s.validate({ sub: 'u-ok', email: 'a@b.com' });
    expect(user.sub).toBe('u-ok');
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('неіснуючий sub при мертвому Redis → 401 (fail-closed)', async () => {
    users.findById.mockRejectedValue(new Error('Користувача не знайдено'));
    const { strategy: s } = strategy();
    await expect(
      s.validate({ sub: 'ghost', email: 'a@b.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
