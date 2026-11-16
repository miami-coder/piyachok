import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VenuesCatalogService } from './venues-catalog.service';
import { Venue } from './entities/venue.entity';
import { CacheService } from '../../common/services/cache.service';

function qb() {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getOne: jest.fn(),
  };
}

describe('VenuesCatalogService', () => {
  let service: VenuesCatalogService;
  let venues: any;
  let cache: any;

  beforeEach(async () => {
    venues = {
      createQueryBuilder: jest.fn().mockReturnValue(qb()),
    };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      delByPattern: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        VenuesCatalogService,
        { provide: getRepositoryToken(Venue), useValue: venues },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    service = module.get(VenuesCatalogService);
  });

  it('search returns from cache when present', async () => {
    cache.get.mockResolvedValueOnce({
      data: [{ id: 'v1', name: 'X' }],
      total: 1,
    });
    const res = await service.search({ page: 1, limit: 20 });
    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBe(1);
  });

  it('search queries DB on cache miss', async () => {
    const res = await service.search({ page: 1, limit: 20 });
    expect(venues.createQueryBuilder).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
    expect(res.data).toEqual([]);
  });

  it('повторний запит сторінки 2 при 16 закладах НЕ порожній (без пере-зріжування)', async () => {
    // перший запит сторінки 2: БД повертає єдиний 16-й рядок
    const pageTwoQb = {
      ...qb(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'v16' }], 16]),
    };
    venues.createQueryBuilder.mockReturnValueOnce(pageTwoQb);
    const first = await service.search({ page: 2, limit: 15 });
    expect(first.data).toHaveLength(1);
    expect(first.meta.total).toBe(16);
    // кеш збережений
    expect(cache.set).toHaveBeenCalled();
    // повторний запит: кеш-хіт із тим самим сторінковим data
    cache.get.mockResolvedValueOnce({ data: [{ id: 'v16' }], total: 16 });
    const second = await service.search({ page: 2, limit: 15 });
    expect(second.data).toHaveLength(1);
    expect(second.meta.total).toBe(16);
    expect(second.data[0].id).toBe('v16');
  });

  describe('фільтри', () => {
    it('recommended=1 — only рекомендовані критиком (/,top), фільтр іде в where', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 1, limit: 12, recommended: '1' });
      const sqls = mockQb.andWhere.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(sqls).toContain('v.recommendedBy IS NOT NULL');
    });

    it('без recommended — клаузи рекомендацій у where НЕ додаються (каталог не лізе у вибір критика)', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 1, limit: 12 });
      const sqls = mockQb.andWhere.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(sqls.some((s: string) => s.includes('recommendedBy'))).toBe(false);
    });

    it('фічі/теги — AND-семантика (заклад має ВСІ запитані), CSV не втрачає значення', async () => {
      const mockQb = venues.createQueryBuilder(); // той самий обʼєкт, що піде у search
      await service.search({
        page: 1,
        limit: 20,
        tag: ' cocktails, dj ',
        feature: 'wifi, parking',
      });
      const sqls = mockQb.andWhere.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      // Для КОЖНОГО запитаного коду свій EXISTS-підзапит (AND), а не один IN (OR)
      expect(
        sqls.some(
          (s: string) => s.includes('EXISTS') && s.includes('f2.code = :'),
        ),
      ).toBe(true);
      const andParams = mockQb.andWhere.mock.calls
        .flat()
        .filter((x: unknown) => typeof x === 'object' && x !== null) as Record<
        string,
        string
      >[];
      const flat = andParams.map((o) => Object.entries(o)).flat();
      for (const code of ['wifi', 'parking']) {
        expect(flat.some(([k, v]) => k.includes('feature') && v === code)).toBe(
          true,
        );
      }
      for (const slug of ['cocktails', 'dj']) {
        expect(flat.some(([k, v]) => k.includes('tag') && v === slug)).toBe(
          true,
        );
      }
    });

    it('q з % та _ залишається літералом у ILIKE (ESCAPE)', async () => {
      await service.search({ page: 1, limit: 20, q: '10%_off' });
      const calls = venues.createQueryBuilder().andWhere.mock.calls;
      // ILIKE живе в Brackets — розгортаємо фабрику проти фейкового будівника
      const bracketArg = calls
        .map((c: unknown[]) => c[0])
        .find((a: any) => a && typeof a.whereFactory === 'function');
      expect(bracketArg).toBeTruthy();
      const rec: { sql: string[]; params: Record<string, unknown>[] } = {
        sql: [],
        params: [],
      };
      const recorder = {
        where(sql: string, params?: Record<string, unknown>) {
          rec.sql.push(sql);
          if (params) rec.params.push(params);
          return recorder;
        },
        orWhere(sql: string, params?: Record<string, unknown>) {
          rec.sql.push(sql);
          if (params) rec.params.push(params);
          return recorder;
        },
      };
      bracketArg.whereFactory(recorder);
      expect(rec.sql[0]).toContain("ESCAPE '!'");
      expect(rec.params[0].q).toBe('%10!%!_off%');
    });
  });

  describe('базовий запит', () => {
    it('лише схвалені заклади, фото/фічі/теги/типи підтягуються join-ами', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 1, limit: 20 });
      expect(mockQb.where).toHaveBeenCalledWith('v.status = :status', {
        status: 'approved',
      });
      expect(
        mockQb.leftJoinAndSelect.mock.calls.map((c: unknown[]) => c.join(' ')),
      ).toEqual([
        'v.photos photo',
        'v.featureAssignments fa',
        'fa.feature f',
        'v.venueTags vt',
        'vt.tag t',
        'v.venueTypeAssignments vta',
        'vta.type ty',
      ]);
    });

    it('сторінка і ліміт перетворюються на skip/take', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 3, limit: 10 });
      expect(mockQb.skip).toHaveBeenCalledWith(20);
      expect(mockQb.take).toHaveBeenCalledWith(10);
    });
  });

  describe('фільтри — діапазони, тип, гео', () => {
    const wheres = (mockQb: any) => mockQb.andWhere.mock.calls;

    it('minRating, minCheck, maxCheck — окремі умови з параметрами', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({
        page: 1,
        limit: 20,
        minRating: 4,
        minCheck: 100,
        maxCheck: 500,
      });
      expect(wheres(mockQb)).toEqual(
        expect.arrayContaining([
          ['v.ratingAvg >= :minRating', { minRating: 4 }],
          ['v.averageCheck >= :minCheck', { minCheck: 100 }],
          ['v.averageCheck <= :maxCheck', { maxCheck: 500 }],
        ]),
      );
    });

    it('нульові межі теж діють (0 — це значення, а не «не задано»)', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 1, limit: 20, minRating: 0, minCheck: 0 });
      expect(wheres(mockQb)).toEqual(
        expect.arrayContaining([
          ['v.ratingAvg >= :minRating', { minRating: 0 }],
          ['v.averageCheck >= :minCheck', { minCheck: 0 }],
        ]),
      );
    });

    it('type — фільтр за слагом типу', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 1, limit: 20, type: 'bar' });
      expect(wheres(mockQb)).toContainEqual([
        'ty.slug = :type',
        { type: 'bar' },
      ]);
    });

    it('lat+lng+radiusKm → ST_DWithin з радіусом у метрах', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({
        page: 1,
        limit: 20,
        lat: 50.45,
        lng: 30.52,
        radiusKm: 5,
      });
      const geo = wheres(mockQb).find((c: unknown[]) =>
        String(c[0]).includes('ST_DWithin'),
      );
      expect(geo).toBeDefined();
      expect(geo[0]).toContain('ST_MakePoint(:lng, :lat)::geography');
      expect(geo[1]).toEqual({ lng: 30.52, lat: 50.45, meters: 5000 });
    });

    it.each([
      ['без radiusKm', { lat: 50.45, lng: 30.52 }],
      ['без lng', { lat: 50.45, radiusKm: 5 }],
      ['без lat', { lng: 30.52, radiusKm: 5 }],
    ])('гео-фільтр не додається %s', async (_name, geo) => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 1, limit: 20, ...geo });
      expect(
        wheres(mockQb).some((c: unknown[]) =>
          String(c[0]).includes('ST_DWithin'),
        ),
      ).toBe(false);
    });

    it('без жодного фільтра andWhere не викликається', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ page: 1, limit: 20 });
      expect(mockQb.andWhere).not.toHaveBeenCalled();
    });

    it('кілька фільтрів накладаються разом (AND), q іде першим у порядку умов', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({
        page: 1,
        limit: 20,
        q: 'бар',
        minRating: 3,
        feature: 'wifi',
        type: 'bar',
        recommended: '1',
      });
      const order = wheres(mockQb).map((c: unknown[]) =>
        typeof c[0] === 'string' ? c[0] : 'brackets',
      );
      expect(order[0]).toBe('brackets');
      expect(order[1]).toBe('v.ratingAvg >= :minRating');
      expect(order[2]).toContain('EXISTS');
      expect(order[3]).toBe('ty.slug = :type');
      expect(order[4]).toBe('v.recommendedBy IS NOT NULL');
    });
  });

  describe('сортування', () => {
    const q = { page: 1, limit: 20 };

    it('rating: за ratingAvg DESC NULLS LAST, потім ratingCount DESC', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ ...q, sort: 'rating' });
      expect(mockQb.orderBy).toHaveBeenCalledWith(
        'v.ratingAvg',
        'DESC',
        'NULLS LAST',
      );
      expect(mockQb.addOrderBy).toHaveBeenCalledWith('v.ratingCount', 'DESC');
    });

    it('check: за середнім чеком ASC NULLS LAST', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ ...q, sort: 'check' });
      expect(mockQb.orderBy).toHaveBeenCalledWith(
        'v.averageCheck',
        'ASC',
        'NULLS LAST',
      );
      expect(mockQb.addOrderBy).not.toHaveBeenCalled();
    });

    it('name: за назвою ASC', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ ...q, sort: 'name' });
      expect(mockQb.orderBy).toHaveBeenCalledWith('v.name', 'ASC');
    });

    it.each([
      ['newest', 'newest' as const],
      ['без sort (дефолт)', undefined],
    ])('%s: за createdAt DESC', async (_name, sort) => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ ...q, sort });
      expect(mockQb.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQb.orderBy).toHaveBeenCalledWith('v.createdAt', 'DESC');
    });

    it('distance з координатами: параметри реєструються, відстань у select, order за distance', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ ...q, sort: 'distance', lat: 50.45, lng: 30.52 });
      // setParameters — без radiusKm ST_MakePoint(:lng, :lat) інакше лишився б сирим
      expect(mockQb.setParameters).toHaveBeenCalledWith({
        lng: 30.52,
        lat: 50.45,
      });
      expect(mockQb.addSelect).toHaveBeenCalledWith(
        'ST_Distance(v.location, ST_MakePoint(:lng, :lat)::geography)',
        'distance',
      );
      expect(mockQb.orderBy).toHaveBeenCalledWith('distance', 'ASC');
    });

    it('distance без координат: відкат на createdAt DESC, без ST_Distance', async () => {
      const mockQb = venues.createQueryBuilder();
      await service.search({ ...q, sort: 'distance' });
      expect(mockQb.orderBy).toHaveBeenCalledWith('v.createdAt', 'DESC');
      expect(mockQb.addSelect).not.toHaveBeenCalled();
      expect(mockQb.setParameters).not.toHaveBeenCalled();
    });
  });

  describe('кешування', () => {
    const keyOf = (query: object) =>
      `venues:list:${createHash('sha1').update(JSON.stringify(query)).digest('hex')}`;

    it('міс: читає і пише той самий ключ (sha1 запиту), TTL 60с, кладе сторінку і total', async () => {
      const query = { page: 2, limit: 15, q: 'бар' };
      const mockQb = venues.createQueryBuilder();
      mockQb.getManyAndCount.mockResolvedValue([[{ id: 'v1' }], 16]);
      const res = await service.search(query);
      expect(cache.get).toHaveBeenCalledWith(keyOf(query));
      expect(cache.set).toHaveBeenCalledWith(
        keyOf(query),
        { data: [{ id: 'v1' }], total: 16 },
        60,
      );
      expect(res.meta).toEqual({
        page: 2,
        limit: 15,
        total: 16,
        hasMore: false,
      });
    });

    it('хіт: БД не чіпається, кеш не перезаписується, meta будується з page/limit запиту', async () => {
      cache.get.mockResolvedValueOnce({ data: [{ id: 'v1' }], total: 40 });
      const res = await service.search({ page: 1, limit: 20 });
      expect(venues.createQueryBuilder).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
      expect(res).toEqual({
        data: [{ id: 'v1' }],
        meta: { page: 1, limit: 20, total: 40, hasMore: true },
      });
    });

    it('різні запити → різні ключі кешу', async () => {
      await service.search({ page: 1, limit: 20 });
      await service.search({ page: 2, limit: 20 });
      const [a, b] = cache.get.mock.calls.map((c: unknown[]) => c[0]);
      expect(a).not.toBe(b);
    });
  });

  describe('кеш-інвалідація', () => {
    it('invalidateListCache скидає весь кеш списку', async () => {
      await service.invalidateListCache();
      expect(cache.delByPattern).toHaveBeenCalledWith('venues:list:*');
    });
  });
});
