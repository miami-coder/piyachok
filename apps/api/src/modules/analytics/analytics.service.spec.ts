import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { VenueView } from './entities/venue-view.entity';
import { Venue } from '../venues/entities/venue.entity';
import { AnalyticsEvent } from './entities/analytics-event.entity';
import { CacheService } from '../../common/services/cache.service';
import { VenuesService } from '../venues/venues.service';
import { PermissionsService } from '../rbac/permissions.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let views: any;
  let eventsRepo: any;
  let cache: any;

  beforeEach(async () => {
    views = {
      save: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };
    eventsRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };
    cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(VenueView), useValue: views },
        {
          provide: getRepositoryToken(Venue),
          useValue: { increment: jest.fn() },
        },
        { provide: getRepositoryToken(AnalyticsEvent), useValue: eventsRepo },
        { provide: CacheService, useValue: cache },
        { provide: VenuesService, useValue: { findOneOrThrow: jest.fn() } },
        {
          provide: PermissionsService,
          useValue: { hasPermission: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();
    service = module.get(AnalyticsService);
  });

  it('recordView inserts on first call', async () => {
    cache.get.mockResolvedValueOnce(null);
    const r = await service.recordView('v1', 'u1');
    expect(r).toEqual({ recorded: true });
    expect(views.save).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  it('recordView dedups within TTL', async () => {
    cache.get.mockResolvedValueOnce('1');
    const r = await service.recordView('v1', 'u1');
    expect(r).toEqual({ recorded: false });
    expect(views.save).not.toHaveBeenCalled();
  });

  it('recordView without identity always records', async () => {
    const r = await service.recordView('v1', null, null);
    expect(r).toEqual({ recorded: true });
    expect(views.save).toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('recordView без userId/sessionId дедупить по IP-фолбеку', async () => {
    cache.get.mockResolvedValueOnce(null);
    const first = await service.recordView('v1', null, null, '203.0.113.7');
    expect(first).toEqual({ recorded: true });
    expect(cache.set).toHaveBeenCalledWith(
      'view:dedup:203.0.113.7:v1',
      '1',
      expect.any(Number),
    );
    cache.get.mockResolvedValueOnce('1');
    const second = await service.recordView('v1', null, null, '203.0.113.7');
    expect(second).toEqual({ recorded: false });
    expect(views.save).toHaveBeenCalledTimes(1);
  });

  it('recordEvent persists analytics event', async () => {
    await service.recordEvent('v1', 'u1', 'review_created', { x: 1 });
    expect(eventsRepo.save).toHaveBeenCalledWith({
      venueId: 'v1',
      userId: 'u1',
      eventType: 'review_created',
      payload: { x: 1 },
    });
  });
});

describe('AnalyticsService.stats — діапазон дат', () => {
  it('totalViews рахується у відборі from..to (інклюзивно до кінця дня to), а не глобально', async () => {
    // загальний у репозиторії 120, але в діапазоні запит — 5; total має бути 5
    const viewsQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { date: '2020-12-30', count: 2 },
        { date: '2020-12-31', count: 3 },
      ]),
    };
    const eventsQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const views = {
      createQueryBuilder: jest.fn().mockReturnValue(viewsQb),
      count: jest.fn().mockResolvedValue(120),
    };
    const eventsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(eventsQb),
      count: jest.fn().mockResolvedValue(9),
    };
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(VenueView), useValue: views },
        {
          provide: getRepositoryToken(Venue),
          useValue: { increment: jest.fn() },
        },
        { provide: getRepositoryToken(AnalyticsEvent), useValue: eventsRepo },
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: VenuesService, useValue: { findOneOrThrow: jest.fn() } },
        {
          provide: PermissionsService,
          useValue: { hasPermission: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();
    const service = module.get(AnalyticsService);
    const res = await service.getForVenue('u1', 'v1', '2020-01-01', '2020-12-31');
    // 2+3 з запиту у діапазоні; count(120) — глобальний — більше не юзається
    expect(res.totalViews).toBe(5);
    // останній день діапазону включно: < (to + 1 день), не <= to
    const withDate = viewsQb.andWhere.mock.calls.find(
      (c) => c[0].includes('viewedAt') && c[0].includes('<'),
    );
    expect(withDate).toBeTruthy();
  });
});

describe('AnalyticsService.recordView — лічильник закладу', () => {
  it('recorded → viewCount закладу інкрементується', async () => {
    const views = {
      save: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };
    const venues = {
      increment: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(VenueView), useValue: views },
        {
          provide: getRepositoryToken(Venue),
          useValue: { increment: jest.fn() },
        },
        {
          provide: getRepositoryToken(AnalyticsEvent),
          useValue: { save: jest.fn() },
        },
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: getRepositoryToken(Venue), useValue: venues },
        { provide: VenuesService, useValue: { findOneOrThrow: jest.fn() } },
        {
          provide: PermissionsService,
          useValue: { hasPermission: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();
    const service = module.get(AnalyticsService);
    const res = await service.recordView('v1', 'u1', null);
    expect(res.recorded).toBe(true);
    expect(venues.increment).toHaveBeenCalledWith({ id: 'v1' }, 'viewCount', 1);
  });

  it('дедуплікація: recorded:false — лічильник не чіпається', async () => {
    const views = {
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const venues = { increment: jest.fn() };
    const cache = { get: jest.fn().mockResolvedValue('1'), set: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(VenueView), useValue: views },
        {
          provide: getRepositoryToken(Venue),
          useValue: { increment: jest.fn() },
        },
        {
          provide: getRepositoryToken(AnalyticsEvent),
          useValue: { save: jest.fn() },
        },
        { provide: CacheService, useValue: cache },
        { provide: getRepositoryToken(Venue), useValue: venues },
        { provide: VenuesService, useValue: { findOneOrThrow: jest.fn() } },
        {
          provide: PermissionsService,
          useValue: { hasPermission: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();
    const service = module.get(AnalyticsService);
    const res = await service.recordView('v1', 'u1', null);
    expect(res.recorded).toBe(false);
    expect(venues.increment).not.toHaveBeenCalled();
  });
});

describe('AnalyticsService.getForVenue — доступ (власник або супер-адмін)', () => {
  let viewsQb: any;
  let venuesService: any;
  let perms: any;
  let service: AnalyticsService;

  beforeEach(async () => {
    viewsQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    venuesService = { findOneOrThrow: jest.fn() };
    perms = { hasPermission: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getRepositoryToken(VenueView),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(viewsQb) },
        },
        { provide: getRepositoryToken(Venue), useValue: { increment: jest.fn() } },
        {
          provide: getRepositoryToken(AnalyticsEvent),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(viewsQb) },
        },
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: VenuesService, useValue: venuesService },
        { provide: PermissionsService, useValue: perms },
      ],
    }).compile();
    service = module.get(AnalyticsService);
  });

  it('супер-адмін з analytics:view:all проходить без походу в базу за закладом', async () => {
    perms.hasPermission.mockResolvedValue(true);
    const res = await service.getForVenue('u1', 'v1');
    expect(perms.hasPermission).toHaveBeenCalledWith('u1', 'analytics:view:all');
    expect(venuesService.findOneOrThrow).not.toHaveBeenCalled();
    expect(res.totalViews).toBe(0);
  });

  it('власник без analytics:view:all отримує метрики', async () => {
    perms.hasPermission.mockResolvedValue(false);
    venuesService.findOneOrThrow.mockResolvedValue({ ownerId: 'u1' });
    const res = await service.getForVenue('u1', 'v1');
    expect(venuesService.findOneOrThrow).toHaveBeenCalledWith('v1');
    expect(res.totalViews).toBe(0);
  });

  it('не-власник отримує 403 і метрики не рахуються', async () => {
    perms.hasPermission.mockResolvedValue(false);
    venuesService.findOneOrThrow.mockResolvedValue({ ownerId: 'other' });
    await expect(service.getForVenue('u1', 'v1')).rejects.toThrow(
      'Немає доступу до аналітики цього закладу',
    );
    expect(viewsQb.getRawMany).not.toHaveBeenCalled();
  });

  it('неіснуючий заклад для не-супер-адміна — 404 з сервісу закладів', async () => {
    perms.hasPermission.mockResolvedValue(false);
    venuesService.findOneOrThrow.mockRejectedValue(
      new NotFoundException('Заклад не знайдено'),
    );
    await expect(service.getForVenue('u1', 'v1')).rejects.toThrow(
      'Заклад не знайдено',
    );
  });
});
