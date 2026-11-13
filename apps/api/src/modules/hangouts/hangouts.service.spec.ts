import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { HangoutsService } from './hangouts.service';
import { Hangout, HangoutStatus } from './entities/hangout.entity';
import { HangoutParticipant } from './entities/hangout-participant.entity';
import { VenuesService } from '../venues/venues.service';
import { CacheService } from '../../common/services/cache.service';

describe('HangoutsService', () => {
  let service: HangoutsService;
  let hangouts: any;
  let em: any;
  let participants: any;
  let venues: any;
  let cache: any;
  let events: any;

  beforeEach(async () => {
    // join тепер іде через manager.transaction з FOR UPDATE:
    // em — об'єкт, яким transaction викликає колбек
    em = {
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((x) => Promise.resolve(x)),
    };
    hangouts = {
      create: jest.fn((x) => x),
      save: jest.fn().mockImplementation((x) => Promise.resolve(x)),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: jest.fn((cb) => cb(em)),
      },
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      }),
    };
    participants = {
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    venues = {
      findOneOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'v1', status: 'approved' }),
    };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delByPattern: jest.fn().mockResolvedValue(undefined),
    };
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        HangoutsService,
        { provide: getRepositoryToken(Hangout), useValue: hangouts },
        {
          provide: getRepositoryToken(HangoutParticipant),
          useValue: participants,
        },
        { provide: VenuesService, useValue: venues },
        { provide: CacheService, useValue: cache },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(HangoutsService);
  });

  const pastDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  it('create rejects past date', async () => {
    await expect(
      service.create('u1', 'v1', {
        date: pastDate(),
        time: '19:00',
        purpose: 'Зустріч для обговорення проєкту',
        groupSize: 2,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('join throws 409 when status is not open', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Filled,
      groupSize: 2,
    });
    await expect(service.join('u2', 'h1')).rejects.toThrow(ConflictException);
  });

  it('join fills hangout and emits event', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Open,
      groupSize: 2,
    });
    em.findOne.mockResolvedValueOnce(null); // existing participant
    em.count.mockResolvedValueOnce(1);
    await service.join('u2', 'h1');
    expect(em.save).toHaveBeenCalledWith(HangoutParticipant, {
      hangoutId: 'h1',
      userId: 'u2',
    });
    expect(em.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: HangoutStatus.Filled }),
    );
    expect(events.emit).toHaveBeenCalledWith('hangout.filled', {
      hangoutId: 'h1',
    });
    expect(cache.delByPattern).toHaveBeenCalledWith('hangouts:list:*');
  });

  it('join перевищення місць неможливе: count перевіряється в транзакції', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Open,
      groupSize: 2,
    });
    em.findOne.mockResolvedValueOnce(null);
    em.count.mockResolvedValueOnce(2); // місць немає
    await expect(service.join('u2', 'h1')).rejects.toThrow(
      new ConflictException('Заявка вже заповнена'),
    );
    expect(em.save).not.toHaveBeenCalledWith(HangoutParticipant, {
      hangoutId: 'h1',
      userId: 'u2',
    });
  });

  it('join з блокуванням рядка заявки (FOR UPDATE у транзакції)', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Open,
      groupSize: 3,
    });
    em.findOne.mockResolvedValueOnce(null);
    em.count.mockResolvedValueOnce(0);
    await service.join('u2', 'h1');
    expect(hangouts.manager.transaction).toHaveBeenCalled();
    expect(em.findOne).toHaveBeenCalledWith(
      Hangout,
      expect.objectContaining({
        where: { id: 'h1' },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(events.emit).not.toHaveBeenCalled(); // не заповнена — події немає
  });

  it('join при подвійному вставленні (23505 від PK) → 409 замість 500', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Open,
      groupSize: 3,
    });
    em.findOne.mockResolvedValueOnce(null);
    em.count.mockResolvedValueOnce(0);
    em.save.mockRejectedValueOnce({ code: '23505', detail: 'duplicate key' });
    await expect(service.join('u2', 'h1')).rejects.toThrow(
      new ConflictException('Ви вже приєднані'),
    );
  });

  it('leave неучасника → 409 «Ви не учасник цієї зустрічі»', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      creatorId: 'u1',
      status: HangoutStatus.Open,
    });
    participants.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.leave('u2', 'h1')).rejects.toThrow(
      new ConflictException('Ви не учасник цієї зустрічі'),
    );
  });

  it('leave учасника — ок, кеш скидається', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      creatorId: 'u1',
      status: HangoutStatus.Open,
    });
    participants.delete.mockResolvedValueOnce({ affected: 1 });
    await service.leave('u2', 'h1');
    expect(cache.delByPattern).toHaveBeenCalledWith('hangouts:list:*');
  });

  it('cancel повторного скасування → 409, без збереження і без події', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      creatorId: 'u1',
      status: HangoutStatus.Cancelled,
    });
    await expect(service.cancel('u1', 'h1')).rejects.toThrow(
      new ConflictException('Заявка вже скасована'),
    );
    expect(hangouts.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('cancel завершеної зустрічі → 409, без «скасування заднім числом»', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      creatorId: 'u1',
      status: HangoutStatus.Completed,
    });
    await expect(service.cancel('u1', 'h1')).rejects.toThrow(
      new ConflictException('Завершену зустріч скасувати не можна'),
    );
    expect(hangouts.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('leave blocks creator when others present', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      creatorId: 'u1',
      status: HangoutStatus.Open,
    });
    participants.count.mockResolvedValueOnce(2);
    await expect(service.leave('u1', 'h1')).rejects.toThrow(ForbiddenException);
  });

  it('cancel forbids non-creator', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      creatorId: 'u1',
      status: HangoutStatus.Open,
    });
    await expect(service.cancel('u2', 'h1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('getOne loads venue + participants-user-profile relations', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Open,
      participants: [
        {
          hangoutId: 'h1',
          userId: 'u1',
          joinedAt: new Date('2026-09-30T10:00:00Z'),
          user: { profile: { firstname: 'Іван', lastname: 'Петренко' } },
        },
      ],
      venue: { id: 'v1' },
    });
    const h = await service.getOne('h1');
    expect(hangouts.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'h1' },
        relations: { participants: { user: { profile: true } }, venue: true },
      }),
    );
    expect(h.participants[0]).toEqual({
      hangoutId: 'h1',
      userId: 'u1',
      joinedAt: new Date('2026-09-30T10:00:00Z'),
      firstname: 'Іван',
      lastname: 'Петренко',
    });
  });

  it('getOne дозволяє не-учаснику дивитись деталі (без 403)', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Open,
      participants: [{ userId: 'someone' }],
      venue: null,
    });
    const h = await service.getOne('h1');
    expect(h.id).toBe('h1');
  });

  it('getOne витримує учасника без profile (фолбек на порожні імена)', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      status: HangoutStatus.Open,
      participants: [
        { hangoutId: 'h1', userId: 'u1', joinedAt: new Date(), user: null },
      ],
      venue: null,
    });
    const h = await service.getOne('h1');
    expect(h.participants[0].firstname).toBe('');
    expect(h.participants[0].lastname).toBe('');
  });
});

describe('HangoutsService.listPublic — кеш-хіт сторінок', () => {
  let service: HangoutsService;
  let hangouts: any;
  let cache: any;
  let venues: any;

  let events: any;

  beforeEach(async () => {
    hangouts = {
      save: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    cache = { get: jest.fn(), set: jest.fn() };
    venues = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        HangoutsService,
        { provide: getRepositoryToken(Hangout), useValue: hangouts },
        {
          provide: getRepositoryToken(HangoutParticipant),
          useValue: {},
        },
        { provide: VenuesService, useValue: venues },
        { provide: CacheService, useValue: cache },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(HangoutsService);
  });

  it('кеш-хіт сторінки 2: total повний (не довжина сторінки)', async () => {
    cache.get.mockResolvedValueOnce({
      data: [{ id: 'h1' }, { id: 'h2' }],
      total: 14,
    });
    const res = await service.listPublic({ page: 2, limit: 12 });
    expect(res.data).toHaveLength(2);
    expect(res.meta.total).toBe(14);
  });
});

describe('HangoutsService.create — лише схвалені заклади', () => {
  let service: HangoutsService;
  let hangouts: any;
  let venues: any;
  let participants: any;
  let cache: any;
  let events: any;

  beforeEach(async () => {
    hangouts = {
      save: jest.fn(),
      create: jest.fn((x) => x),
      findOne: jest.fn(),
    };
    participants = { save: jest.fn() };
    venues = {
      findOneOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'v1', status: 'pending' }),
    };
    cache = { get: jest.fn(), set: jest.fn(), delByPattern: jest.fn() };
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        HangoutsService,
        { provide: getRepositoryToken(Hangout), useValue: hangouts },
        {
          provide: getRepositoryToken(HangoutParticipant),
          useValue: participants,
        },
        { provide: VenuesService, useValue: venues },
        { provide: CacheService, useValue: cache },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(HangoutsService);
  });

  const futureDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().slice(0, 10);
  };

  // create — теж мутація стрічки: без скиду кешу новий запит на /hangouts
  // не видний до кінця TTL кешу
  it('create → скидає кеш списку пиячів (delByPattern hangouts:list:*)', async () => {
    venues.findOneOrThrow.mockResolvedValueOnce({
      id: 'v1',
      status: 'approved',
    });
    await service.create('u1', 'v1', {
      date: futureDate(),
      time: '20:00',
      purpose: 'Після створення кеш списку теж чиститься',
      groupSize: 3,
    });
    expect(cache.delByPattern).toHaveBeenCalledWith('hangouts:list:*');
  });

  it('create пиячок на pending-заклад → ForbiddenException', async () => {
    await expect(
      service.create('u1', 'v1', {
        date: futureDate(),
        time: '20:00',
        purpose: 'Пива',
        groupSize: 3,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create пиячок на archived-заклад → ForbiddenException', async () => {
    venues.findOneOrThrow.mockResolvedValueOnce({
      id: 'v1',
      status: 'archived',
    });
    await expect(
      service.create('u1', 'v1', {
        date: futureDate(),
        time: '20:00',
        purpose: 'Пива',
        groupSize: 3,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create на approved — ок', async () => {
    venues.findOneOrThrow.mockResolvedValueOnce({
      id: 'v1',
      status: 'approved',
    });
    await expect(
      service.create('u1', 'v1', {
        date: futureDate(),
        time: '20:00',
        purpose: 'Пива',
        groupSize: 3,
      }),
    ).resolves.toBeDefined();
  });
});

describe('HangoutsService.getOne — видалений учасник', () => {
  it('імʼя видаленого учасника приховано як «Обліковий запис видалено»', async () => {
    const repo = () => ({
      save: jest.fn(),
      create: jest.fn((x) => x),
      findOne: jest.fn(),
      findOneOrThrow: jest.fn(),
      createQueryBuilder: jest.fn(),
    });
    const hangouts = repo();
    hangouts.findOne = jest.fn().mockResolvedValue({
      id: 'h1',
      participants: [
        {
          hangoutId: 'h1',
          userId: 'u-del',
          joinedAt: new Date(),
          user: {
            id: 'u-del',
            email: 'del@x.com',
            deletedAt: new Date(),
            profile: { firstname: 'Тарас', lastname: 'Секретний' },
          },
        },
        {
          hangoutId: 'h1',
          userId: 'u-ok',
          joinedAt: new Date(),
          user: {
            id: 'u-ok',
            email: 'ok@x.com',
            deletedAt: null,
            profile: { firstname: 'Олег', lastname: 'Савчук' },
          },
        },
      ],
    });
    const venues = repo();
    venues.findOneOrThrow = jest
      .fn()
      .mockResolvedValue({ id: 'v1', status: 'approved' });
    const module = await Test.createTestingModule({
      providers: [
        HangoutsService,
        { provide: getRepositoryToken(Hangout), useValue: hangouts },
        { provide: getRepositoryToken(HangoutParticipant), useValue: repo() },
        { provide: VenuesService, useValue: venues },
        {
          provide: CacheService,
          useValue: { get: jest.fn(), set: jest.fn(), delByPattern: jest.fn() },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    const service = module.get(HangoutsService);
    const res = await service.getOne('h1');
    const del = res.participants.find((p) => p.userId === 'u-del')!;
    const ok = res.participants.find((p) => p.userId === 'u-ok')!;
    expect(del.firstname).toBe('Обліковий запис');
    expect(del.lastname).toBe('видалено');
    expect(ok.firstname).toBe('Олег');
    expect(ok.lastname).toBe('Савчук');
    expect(JSON.stringify(res)).not.toContain('Секретний');
  });
});

describe('HangoutsService — дата+час і видалення автором', () => {
  let service: HangoutsService;
  let hangouts: any;
  let participants: any;
  let venues: any;
  let cache: any;
  let events: any;

  beforeEach(async () => {
    hangouts = {
      save: jest.fn((x) => Promise.resolve(x)),
      create: jest.fn((x) => x),
      findOne: jest.fn(),
      delete: jest.fn(),
    };
    participants = { save: jest.fn(), delete: jest.fn(), count: jest.fn() };
    venues = {
      findOneOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'v1', status: 'approved' }),
      createQueryBuilder: jest.fn(),
    };
    cache = { get: jest.fn(), set: jest.fn(), delByPattern: jest.fn() };
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        HangoutsService,
        { provide: getRepositoryToken(Hangout), useValue: hangouts },
        {
          provide: getRepositoryToken(HangoutParticipant),
          useValue: participants,
        },
        { provide: VenuesService, useValue: venues },
        { provide: CacheService, useValue: cache },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(HangoutsService);
  });

  it('create на сьогодні о 00:01 (минулий час) → 400, не тільки «до початку дня»', async () => {
    const today = new Date();
    const date = today.toISOString().slice(0, 10);
    await expect(
      service.create('u1', 'v1', {
        date,
        time: '00:01',
        purpose: 'Було',
        groupSize: 3,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // Взимку офсет Europe/Kyiv — +2: зустріч, що почнеться через півгодини,
  // відсіювалась жорстким +03:00 (парсилось на годину раніше), хоч вона
  // ще в майбутньому. Офсет тепер той самий, що й у базі.
  it('create взимку за 25 хв до початку — ок', async () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-01-15T19:35:00Z').getTime()); // 21:35 за Києвом
    await expect(
      service.create('u1', 'v1', {
        date: '2026-01-15',
        time: '22:00',
        purpose: 'Майбутня зимова зустріч',
        groupSize: 3,
      }),
    ).resolves.toBeDefined();
    nowSpy.mockRestore();
  });

  it('create на сьогодні 23:00 — ок', async () => {
    const today = new Date();
    const date = today.toISOString().slice(0, 10);
    await expect(
      service.create('u1', 'v1', {
        date,
        time: '23:00',
        purpose: 'Буде',
        groupSize: 3,
      }),
    ).resolves.toBeDefined();
  });

  it('create «на пару годин назад» за Києвом → 400 (введений час трактується як київський, не UTC)', async () => {
    // 2026-10-23 17:43 UTC = 20:43 за Києвом: «19:00» — це 2 години тому
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T17:43:00Z'));
    try {
      await expect(
        service.create('u1', 'v1', {
          date: '2026-10-23',
          time: '19:00',
          purpose: 'Три години тому',
          groupSize: 3,
        }),
      ).rejects.toThrow(BadRequestException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('create «за годину вперед» за Києвом — ок (17:43 UTC = 20:43 Києва → 22:00 майбутнє)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T17:43:00Z'));
    try {
      await expect(
        service.create('u1', 'v1', {
          date: '2026-10-23',
          time: '22:00',
          purpose: 'Через годину',
          groupSize: 3,
        }),
      ).resolves.toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('delete: автор видаляє запит повністю', async () => {
    hangouts.findOne.mockResolvedValueOnce({
      id: 'h1',
      creatorId: 'u1',
      status: 'open',
    });
    await service.delete('u1', 'h1');
    expect(hangouts.delete).toHaveBeenCalledWith('h1');
    expect(cache.delByPattern).toHaveBeenCalled();
  });

  it('delete: не-автор → 403', async () => {
    hangouts.findOne.mockResolvedValueOnce({ id: 'h1', creatorId: 'u9' });
    await expect(service.delete('u2', 'h1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(hangouts.delete).not.toHaveBeenCalled();
  });
});
