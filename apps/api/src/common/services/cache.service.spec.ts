import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { makeConfigMock } from '../../testing/config-mock';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let service: CacheService;
  const origHost = process.env.REDIS_HOST;
  const origPort = process.env.REDIS_PORT;
  const origUrl = process.env.REDIS_URL;

  beforeEach(async () => {
    // Направляємо на недосяжний порт, щоб no-op fallback-гілка відпрацьовувала
    // детерміновано, незалежно від того, чи запущено справжній Redis.
    delete process.env.REDIS_URL;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '1';
    const module = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: ConfigService, useValue: makeConfigMock() },
      ],
    }).compile();
    service = module.get(CacheService);
  });

  afterEach(async () => {
    if (origUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = origUrl;
    if (origHost === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = origHost;
    if (origPort === undefined) delete process.env.REDIS_PORT;
    else process.env.REDIS_PORT = origPort;
  });

  it('returns null when redis is not connected', async () => {
    await service.onModuleInit();
    expect(await service.get('any-key')).toBeNull();
    expect(service.isConnected()).toBe(false);
    await service.onModuleDestroy();
  });

  it('set does not throw when redis is not connected', async () => {
    await service.onModuleInit();
    await expect(service.set('key', { a: 1 })).resolves.toBeUndefined();
    await expect(service.del('key')).resolves.toBeUndefined();
    await expect(service.delByPattern('pattern:*')).resolves.toBeUndefined();
    await service.onModuleDestroy();
  });

  // no-op fallback: без редісу claim завжди «успішний», щоб ротація
  // refresh-токенів деградувала до колишньої поведінки, а не лочилась
  it('setIfNotExists returns true when redis is not connected', async () => {
    await service.onModuleInit();
    await expect(service.setIfNotExists('key', { a: 1 }, 60)).resolves.toBe(
      true,
    );
    await service.onModuleDestroy();
  });
});
