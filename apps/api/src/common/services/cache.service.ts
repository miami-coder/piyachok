import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Шар над Redis. Для функціональних кешів (списки, пермішени) відсутність
 * Redis означає лише промах — але безпекові перевірки (прапор видаленого
 * юзера, ревокація refresh-токенів) теж живуть тут, тому просто глушити
 * зʼєднання мовчки не можна: клієнт має перепідключатися після збою
 * (retryStrategy з бекофом), а isConnected() — показувати реальний стан,
 * щоб місця з перевірками безпеки могли відрізнити «ключа нема» від
 * «Redis мертвий» і перейти в явний fallback замість тихого no-op.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;
  private connected = false;
  // Щоб warn про падіння не спамив: логуємо лише перехід up → down.
  private downLogged = false;
  private everConnected = false;
  private reconnectSweeper: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.createClient();
    try {
      // Невдалий первинний конект відхиляє promise швидко; авто-перепідключення
      // продовжується у фоні за retryStrategy — бут застосунку не блокуємо.
      await this.client!.connect();
      this.connected = true;
      this.logger.log('Redis connected');
    } catch {
      this.connected = false;
      this.logger.warn(
        'Redis недоступний — повторні спроби підключення тривають у фоні; поки що кеш працює як no-op, і безпекові перевірки йдуть через fallback',
      );
    }
    // Страховка: якщо ioredis скончив reconnect-цикли (статус 'end'), через
    // 30с піднімаємо новий клієнт. При живому retryStrategy це no-op.
    this.reconnectSweeper = setInterval(() => this.resurrect(), 30_000);
    this.reconnectSweeper.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconnectSweeper) {
      clearInterval(this.reconnectSweeper);
      this.reconnectSweeper = null;
    }
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      this.connected = false;
    }
  }

  private createClient() {
    // Пріоритет REDIS_URL (хостед-редіс, напр. Redis Cloud / redis.io):
    // схема rediss:// самою бібліотекою означає TLS-зʼєднання.
    const commonOpts = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Бекоф з cap 30с: після збою зʼєднання клієнт сам перепідключається,
      // замість один раз спробувати і мовчки померти назавжди.
      retryStrategy: (times: number) => Math.min(times * 1000, 30_000),
    } as const;
    // Host/port/URL приходять з валідованого конфіга (дефолти — в EnvVars).
    const redisUrl = this.config.get<string>('REDIS_URL');
    const redisPort = Number(this.config.get<number>('REDIS_PORT')) || 6379;
    this.client = redisUrl
      ? new Redis(redisUrl, commonOpts)
      : new Redis({
          host: this.config.get<string>('REDIS_HOST'),
          port: redisPort,
          ...commonOpts,
        });

    this.client.on('ready', () => {
      const wasDown = !this.connected;
      this.connected = true;
      this.everConnected = true;
      this.downLogged = false;
      if (wasDown) this.logger.log('Redis (пере)підключено');
    });
    this.client.on('error', () => {
      // До першого 'ready' про падіння повідомляє onModuleInit — не дублюємо.
      if (this.everConnected && (!this.connected || !this.downLogged)) {
        this.logger.warn('Redis недоступний — безпекові прапори беруться з fallback-джерела');
      }
      this.connected = false;
      this.downLogged = true;
    });
    this.client.on('end', () => {
      this.connected = false;
    });
  }

  /** Redis завершив reconnect-цикли (status 'end') — підняти свіжий клієнт. */
  private resurrect() {
    if (this.connected || !this.client || this.client.status !== 'end') return;
    this.client.disconnect();
    this.connected = false;
    this.createClient();
    this.client.connect().catch(() => {
      /* повторна спроба через 30с */
    });
  }

  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  async get<T>(key: string): Promise<T | null> {
    const client = this.client;
    if (!client || !this.connected) return null;
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const client = this.client;
    if (!client || !this.connected) return;
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds) {
        await client.set(key, payload, 'EX', ttlSeconds);
      } else {
        await client.set(key, payload);
      }
    } catch {
      // тихо ігноруємо
    }
  }

  // Атомарний SET NX: записує ключ, тільки якщо його ще не існує. Єдиний
  // спосіб розділити паралельні претенденти: переможець визначається самим
  // редісом, без гонки між get і set (класичний check-then-set двох запитів
  // проходить обидва). Відсутність редісу / мережева помилка → true, щоб
  // функціональність деградувала до поведінки no-op кешу, а не лочилась.
  async setIfNotExists(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<boolean> {
    const client = this.client;
    if (!client || !this.connected) return true;
    try {
      const res = ttlSeconds
        ? await client.set(key, JSON.stringify(value), 'EX', ttlSeconds, 'NX')
        : await client.set(key, JSON.stringify(value), 'NX');
      return res === 'OK';
    } catch {
      return true;
    }
  }

  async del(key: string): Promise<void> {
    const client = this.client;
    if (!client || !this.connected) return;
    try {
      await client.del(key);
    } catch {
      // тихо ігноруємо
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    const client = this.client;
    if (!client || !this.connected) return;
    try {
      const keys = await client.keys(pattern);
      if (keys.length) await client.del(...keys);
    } catch {
      // тихо ігноруємо
    }
  }
}
