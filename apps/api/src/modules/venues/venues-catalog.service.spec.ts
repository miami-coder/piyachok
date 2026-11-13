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
      expect(sqls.some((s: string) => s.includes('recommendedBy'))).toBe(
        false,
      );
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

  describe('кеш-інвалідація', () => {
    it('invalidateListCache скидає весь кеш списку', async () => {
      await service.invalidateListCache();
      expect(cache.delByPattern).toHaveBeenCalledWith('venues:list:*');
    });
  });
});
