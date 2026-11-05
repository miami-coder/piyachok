import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';
import { ReviewListQueryDto } from '../../modules/reviews/dto/query-reviews.dto';
import { NewsAdminQueryDto } from '../../modules/news/dto/query-news.dto';
import {
  HangoutListQueryDto,
  MyHangoutsQueryDto,
} from '../../modules/hangouts/dto/query-hangouts.dto';
import {
  AnalyticsRangeQueryDto,
  VenueStatsQueryDto,
} from '../../modules/analytics/dto/query-analytics.dto';

/**
 * Query-DTO — контракт вхідних фільтрів на межі HTTP: глобальний
 * ValidationPipe робить plainToInstance + validate, але пайп у юніт-тесті
 * не застосовується, тому ту саму поведінку перевіряємо вручну.
 */

async function errors(dtoClass: any, raw: object): Promise<string[]> {
  const dto = plainToInstance(dtoClass, raw);
  const errs = await validate(dto as object);
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('PaginationQueryDto', () => {
  it('перетворює сирі строки з query на числа', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '2', limit: '10' });
    expect(await validate(dto as object)).toEqual([]);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });

  it('відсутні page/limit лишаються undefined (дефолти дає сервіс)', async () => {
    const dto = plainToInstance(PaginationQueryDto, {});
    expect(await validate(dto as object)).toEqual([]);
    expect(dto.page).toBeUndefined();
    expect(dto.limit).toBeUndefined();
  });

  it('не числове limit відкидає (замість NaN у SQL)', async () => {
    const errs = await errors(PaginationQueryDto, { limit: 'abc' });
    expect(errs).toContain('isNumber');
  });

  it('page нижче межі відкидає', async () => {
    const errs = await errors(PaginationQueryDto, { page: '0' });
    expect(errs).toContain('min');
  });

  it('limit вище MAX_LIMIT відкидає', async () => {
    const errs = await errors(PaginationQueryDto, { limit: '999' });
    expect(errs).toContain('max');
  });
});

describe('Role у /me/hangouts (замість inline-перевірки контролера)', () => {
  it('обовʼязкова: відсутнє значення відкидає', async () => {
    expect(await errors(MyHangoutsQueryDto, {})).toContain('isIn');
  });

  it('невідоме значення відкидає — не провалюється у гілку all', async () => {
    expect(await errors(MyHangoutsQueryDto, { role: 'bogus' })).toContain(
      'isIn',
    );
  });

  it('валідні ролі проходять', async () => {
    for (const role of ['created', 'joined', 'all']) {
      expect(await errors(MyHangoutsQueryDto, { role })).toEqual([]);
    }
  });
});

describe('ReviewListQueryDto', () => {
  it('невідомий sort відкидає (сервісний fallback лишається захистом)', async () => {
    expect(await errors(ReviewListQueryDto, { sort: 'bogus' })).toContain(
      'isIn',
    );
    expect(await errors(ReviewListQueryDto, { sort: 'highest' })).toEqual([]);
  });
});

describe('NewsAdminQueryDto', () => {
  it('невідомий status відкидає', async () => {
    expect(await errors(NewsAdminQueryDto, { status: 'hacked' })).toContain(
      'isIn',
    );
  });

  it('isPromoted приймає тільки true', async () => {
    expect(await errors(NewsAdminQueryDto, { isPromoted: 'true' })).toEqual([]);
    expect(await errors(NewsAdminQueryDto, { isPromoted: 'false' })).toContain(
      'isIn',
    );
  });
});

describe('HangoutListQueryDto', () => {
  it('невалідна дата відкидає', async () => {
    expect(await errors(HangoutListQueryDto, { date: 'not-a-date' })).toContain(
      'isIso8601',
    );
    expect(await errors(HangoutListQueryDto, { date: '2026-01-15' })).toEqual(
      [],
    );
  });

  it('невідомий статус відкидає (сервісу більше не приходить сміття)', async () => {
    expect(await errors(HangoutListQueryDto, { status: 'bogus' })).toContain(
      'isIn',
    );
    expect(await errors(HangoutListQueryDto, { status: 'filled' })).toEqual([]);
  });
});

describe('Analytics DTO', () => {
  it('невалідний діапазон відкидає', async () => {
    expect(await errors(AnalyticsRangeQueryDto, { from: 'abc' })).toContain(
      'isIso8601',
    );
    expect(
      await errors(AnalyticsRangeQueryDto, {
        from: '2026-01-01',
        to: '2026-01-31',
      }),
    ).toEqual([]);
  });

  it('VenueStatsQueryDto перетворює page/limit як PaginationQueryDto', async () => {
    const dto = plainToInstance(VenueStatsQueryDto, { page: '3', limit: '5' });
    expect(await validate(dto as object)).toEqual([]);
    expect(instanceToPlain(dto)).toEqual({ page: 3, limit: 5 });
  });
});
