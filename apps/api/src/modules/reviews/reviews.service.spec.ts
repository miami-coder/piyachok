import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReviewsService } from './reviews.service';
import { Review } from './entities/review.entity';
import { VenuesService } from '../venues/venues.service';
import { PermissionsService } from '../rbac/permissions.service';
import { makePermsMock } from '../../testing/permissions-mock';
import type { SanitizedUser } from '../../common/utils/sanitize-user';

function qb() {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ avg: '4.5', count: '2' }),
  };
}

describe('ReviewsService', () => {
  let service: ReviewsService;
  let reviews: any;
  let venues: any;
  let venuesService: any;
  let perms: any;
  let events: any;

  beforeEach(async () => {
    reviews = {
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb()),
      // em «всерід» — сам мок репозиторію: save/delete/queryBuilder спеки
      // і є тим, що відбувається всередині транзакції
      manager: { transaction: jest.fn(async (cb: any) => cb(reviews)) },
    };
    venues = { findOne: jest.fn(), update: jest.fn() };
    // Спільна перевірка venues.service: успіх повертає заклад, несхвалений/
    // неіснуючий кидає 404. Статистику рейтингу мутуємо теж через venues.service.
    venuesService = {
      findByIdApprovedOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'v1', ownerId: 'u9', status: 'approved' }),
      updateRatingStats: jest.fn().mockResolvedValue(undefined),
      invalidateCatalogCache: jest.fn().mockResolvedValue(undefined),
    };
    perms = makePermsMock();
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviews },
        { provide: VenuesService, useValue: venuesService },
        { provide: PermissionsService, useValue: perms },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(ReviewsService);
  });

  it('create throws 404 when venue check fails (не існує або не схвалений)', async () => {
    venuesService.findByIdApprovedOrThrow.mockRejectedValueOnce(
      new NotFoundException('Заклад не знайдено'),
    );
    await expect(
      service.create('u1', 'v1', {
        rating: 5,
        text: 'Чудовий заклад! Рекомендую',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('create throws 403 when reviewer is the venue owner', async () => {
    venuesService.findByIdApprovedOrThrow.mockResolvedValueOnce({
      id: 'v1',
      ownerId: 'u1',
      status: 'approved',
    });
    reviews.save.mockResolvedValueOnce({ id: 'r-new' });
    await expect(
      service.create('u1', 'v1', {
        rating: 5,
        text: 'Чудовий заклад! Рекомендую',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(reviews.save).not.toHaveBeenCalled();
  });

  it('create throws 409 on duplicate review', async () => {
    reviews.findOne.mockResolvedValueOnce({ id: 'r1' });
    await expect(
      service.create('u1', 'v1', {
        rating: 5,
        text: 'Чудовий заклад! Рекомендую',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('create saves and recalcs rating', async () => {
    reviews.findOne.mockResolvedValueOnce(null);
    reviews.save.mockResolvedValueOnce({ id: 'r-new' });
    const r = await service.create('u1', 'v1', {
      rating: 5,
      text: 'Чудовий заклад! Рекомендую',
    });
    expect(r.id).toBe('r-new');
    expect(venuesService.updateRatingStats).toHaveBeenCalledWith(
      'v1',
      { ratingAvg: 4.5, ratingCount: 2 },
      reviews /* em — транзакція перерахунку */,
    );
    expect(events.emit).toHaveBeenCalledWith(
      'review.created',
      expect.anything(),
    );
  });

  it('паралельний create двох однакових відгуків: юнік-індекс (23505) → 409', async () => {
    reviews.findOne.mockResolvedValueOnce(null);
    reviews.save.mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.create('u1', 'v1', {
        rating: 5,
        text: 'Дубль відгуку',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('update forbids non-owner without perm', async () => {
    reviews.findOne.mockResolvedValueOnce({
      id: 'r1',
      userId: 'u2',
      venueId: 'v1',
    });
    perms.hasPermission.mockResolvedValueOnce(false);
    await expect(
      service.update('u1', 'r1', { text: 'X' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('update allows super_admin', async () => {
    reviews.findOne.mockResolvedValueOnce({
      id: 'r1',
      userId: 'u2',
      venueId: 'v1',
      rating: 5,
      text: '...',
    });
    perms.hasPermission.mockResolvedValueOnce(true);
    await service.update('admin', 'r1', { text: 'X' });
    expect(events.emit).toHaveBeenCalledWith(
      'review.updated',
      expect.anything(),
    );
  });

  it('softDelete removes and recalcs', async () => {
    reviews.findOne.mockResolvedValueOnce({
      id: 'r1',
      userId: 'u1',
      venueId: 'v1',
    });
    await service.softDelete('u1', 'r1');
    expect(reviews.delete).toHaveBeenCalledWith(Review, 'r1');
    expect(events.emit).toHaveBeenCalledWith(
      'review.deleted',
      expect.anything(),
    );
  });

  describe('feature/unfeature', () => {
    it('feature sets isFeatured=true and saves', async () => {
      reviews.findOne.mockResolvedValueOnce({ id: 'r1', isFeatured: false });
      await service.feature('r1');
      expect(reviews.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', isFeatured: true }),
      );
    });

    it('unfeature sets isFeatured=false and saves', async () => {
      reviews.findOne.mockResolvedValueOnce({ id: 'r1', isFeatured: true });
      await service.unfeature('r1');
      expect(reviews.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', isFeatured: false }),
      );
    });

    it('feature/unfeature throws 404 when review missing', async () => {
      reviews.findOne.mockResolvedValue(null);
      await expect(service.feature('nope')).rejects.toThrow(NotFoundException);
      await expect(service.unfeature('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

describe('ReviewsService — санітизація авторів відгуків', () => {
  let service: ReviewsService;
  let reviews: any;
  let perms: any;
  let events: any;

  beforeEach(async () => {
    reviews = {
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb()),
      // em «всерід» — сам мок репозиторію: save/delete/queryBuilder спеки
      // і є тим, що відбувається всередині транзакції
      manager: { transaction: jest.fn(async (cb: any) => cb(reviews)) },
    };
    perms = makePermsMock();
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviews },
        {
          provide: VenuesService,
          useValue: {
            findByIdApprovedOrThrow: jest.fn(),
            updateRatingStats: jest.fn().mockResolvedValue(undefined),
            invalidateCatalogCache: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: PermissionsService, useValue: perms },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(ReviewsService);
  });

  it('listForVenue з невідомим або порожнім sort падає в newest, а не кидає помилку', async () => {
    const makeQb = () => {
      const addOrderBy = jest.fn().mockReturnThis();
      return {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy,
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest
          .fn()
          .mockResolvedValue([[{ id: 'r1', user: {} }], 1]),
        lastAddOrderBy: addOrderBy,
      };
    };
    const qbBogus = makeQb();
    const qbEmpty = makeQb();
    reviews.createQueryBuilder
      .mockReturnValueOnce(qbBogus)
      .mockReturnValueOnce(qbEmpty);
    await service.listForVenue('v1', 1, 20, 'bogus' as never);
    expect(qbBogus.lastAddOrderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
    await service.listForVenue('v1', 1, 20, '' as never);
    expect(qbEmpty.lastAddOrderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
  });

  it('listForVenue віддає автора без email/passwordHash/emailVerified/deletedAt', async () => {
    const author = {
      id: 'u1',
      email: 'author@example.com',
      passwordHash: '$2b$10$secretsecretsecret',
      emailVerified: true,
      deletedAt: null,
      profile: { firstname: 'Іван', avatarUrl: null },
    };
    reviews.createQueryBuilder.mockReturnValueOnce({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest
        .fn()
        .mockResolvedValue([[{ id: 'r1', user: author }], 1]),
    });
    const res = await service.listForVenue('v1');
    expect(res.data[0].user).not.toHaveProperty('email');
    expect(res.data[0].user).not.toHaveProperty('passwordHash');
    expect(res.data[0].user).not.toHaveProperty('emailVerified');
    expect(res.data[0].user).not.toHaveProperty('deletedAt');
    expect((res.data[0].user as any).profile.firstname).toBe('Іван');
  });
});

describe('ReviewsService.create — лише схвалені заклади (404-маска)', () => {
  let service: ReviewsService;
  let reviews: any;
  let venuesService: any;
  let perms: any;
  let events: any;

  beforeEach(async () => {
    reviews = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => x),
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb()),
      // em «всерід» — сам мок репозиторію
      manager: { transaction: jest.fn(async (cb: any) => cb(reviews)) },
    };
    // Несхвалений (pending/archived) заклад виглядає як неіснуючий —
    // правило venues.service.findByIdApprovedOrThrow.
    venuesService = {
      findByIdApprovedOrThrow: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Заклад не знайдено')),
      updateRatingStats: jest.fn().mockResolvedValue(undefined),
      invalidateCatalogCache: jest.fn().mockResolvedValue(undefined),
    };
    perms = makePermsMock();
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviews },
        { provide: VenuesService, useValue: venuesService },
        { provide: PermissionsService, useValue: perms },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(ReviewsService);
  });

  it('create на pending-заклад → 404', async () => {
    await expect(
      service.create('u1', 'v1', {
        rating: 5,
        text: 'Супер заклад! Рекомендую',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('create на archived-заклад → 404', async () => {
    await expect(
      service.create('u1', 'v1', {
        rating: 5,
        text: 'Супер заклад! Рекомендую',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('create на approved — ок', async () => {
    venuesService.findByIdApprovedOrThrow.mockResolvedValueOnce({
      ownerId: 'u9',
      id: 'v1',
      status: 'approved',
    });
    await expect(
      service.create('u1', 'v1', {
        rating: 5,
        text: 'Супер заклад! Рекомендую',
      }),
    ).resolves.toBeDefined();
  });
});

describe('ReviewsService.listForVenue — видалений автор', () => {
  it('автор з deletedAt → isDeleted-псевдо-профіль замість реальних даних', async () => {
    let service: ReviewsService;
    const reviews = {
      create: jest.fn((x) => x),
      save: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValueOnce({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 'r1',
              user: {
                id: 'u-del',
                email: 'del@x.com',
                passwordHash: '$2b$10$secret',
                deletedAt: new Date(),
                profile: { firstname: 'Тарас', lastname: 'Секретний' },
              },
            },
          ],
          1,
        ]),
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviews },
        {
          provide: VenuesService,
          useValue: { findByIdApprovedOrThrow: jest.fn() },
        },
        { provide: PermissionsService, useValue: makePermsMock() },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(ReviewsService);
    const res = await service.listForVenue('v1');
    const u = res.data[0].user as SanitizedUser;
    expect(u.isDeleted).toBe(true);
    expect(u.profile).toEqual({
      firstname: 'Обліковий запис',
      lastname: 'видалено',
    });
    expect(JSON.stringify(res)).not.toContain('Секретний');
  });
});
