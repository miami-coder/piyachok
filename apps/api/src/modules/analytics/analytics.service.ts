import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { VenueView } from './entities/venue-view.entity';
import { AnalyticsEvent } from './entities/analytics-event.entity';
import { CacheService } from '../../common/services/cache.service';
import { VenuesService } from '../venues/venues.service';
import { PermissionsService } from '../rbac/permissions.service';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';

export type Granularity = 'day' | 'week' | 'month';

const VIEW_DEDUP_TTL = 1800; // 30 хвилин

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(VenueView)
    private readonly views: Repository<VenueView>,
    @InjectRepository(AnalyticsEvent)
    private readonly eventsRepo: Repository<AnalyticsEvent>,
    private readonly cache: CacheService,
    private readonly venuesService: VenuesService,
    private readonly perms: PermissionsService,
  ) {}

  /**
   * Дедуп тільки за реальними ідентичностями: userId (логін) або sessionId
   * (анонімна сесія браузера). IP і заголовки навмисно не читаються: до API
   * вони доходять без проміжного довіреного проксі, отже будь-який
   * X-Forwarded-For задається самим клієнтом — «дедуп по IP» обходився
   * підміною заголовка, тому без userId/sessionId перегляд не записується.
   */
  /** Спільний фільтр діапазону для всіх аналітичних запитів: from —
   *  включно, to — включно до кінця дня (строкова конкатенація з
   *  ISO-часом падала в PG 22007, тому to спершу каститься до date
   *  і додається день). column — константа з репозиторіїв цього
   *  сервісу, не користувацький вхід. */
  private applyDateRange(
    qb: SelectQueryBuilder<any>,
    column: string,
    from?: string,
    to?: string,
  ): void {
    if (from) qb.andWhere(`${column} >= :from`, { from });
    if (to) qb.andWhere(`${column} < (:to)::date + interval '1 day'`, { to });
  }

  async recordView(
    venueId: string,
    userId?: string | null,
    sessionId?: string | null,
  ): Promise<{ recorded: boolean }> {
    // Перегляд буває тільки на публічній сторінці закладу: правило
    // «заклад схвалений» — спільна перевірка venues.service. Без неї
    // FK на venue_views давав би 500 на неіснуючому id.
    await this.venuesService.findByIdApprovedOrThrow(venueId);
    const identity = userId ?? sessionId;
    if (!identity) return { recorded: false };
    const dedupKey = `view:dedup:${identity}:${venueId}`;
    const seen = await this.cache.get<string>(dedupKey);
    if (seen) return { recorded: false };
    // Рядок перегляду і лічильник закладу — одна транзакція: розсинхрон
    // «перегляд записаний, лічильник старий» або навпаки неможливий.
    await this.views.manager.transaction(async (em) => {
      await em.save(VenueView, {
        venueId,
        userId: userId ?? null,
        sessionId: sessionId ?? null,
      });
      await this.venuesService.incrementViewCount(venueId, em);
    });
    // Ключ дедупу ставимо тільки після успішного коміту: якщо запис
    // впав, ідентичність не спалена на TTL і ретрай можливий
    await this.cache.set(dedupKey, '1', VIEW_DEDUP_TTL);
    return { recorded: true };
  }

  async recordEvent(
    venueId: string | null,
    userId: string | null,
    eventType: string,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    await this.eventsRepo.save({ venueId, userId, eventType, payload });
  }

  /**
   * Хто бачить аналітику закладу — сам заклад існує і юзер його власник
   * (перевірка живе тут, у сервісі, а не в контролері). Супер-адмін з
   * analytics:view:all повертається до походу в базу: як і раніше, неіснуючий
   * заклад для нього — не 404, а порожні метрики.
   */
  private async assertCanView(userId: string, venueId: string): Promise<void> {
    // Спершу право: супер-адмін іде повз читання закладу й отримує порожні
    // метрики на неіснуючий id, а не 404.
    if (await this.perms.hasPermission(userId, 'analytics:view:all')) return;
    const venue = await this.venuesService.findOneOrThrow(venueId);
    // право вже не пройшло вище — тут вирішує только володіння закладом
    await this.perms.assertOwnerOrPermission(
      venue.ownerId,
      userId,
      'analytics:view:all',
      'Немає доступу до аналітики цього закладу',
    );
  }

  async getForVenue(
    userId: string,
    venueId: string,
    from?: string,
    to?: string,
  ): Promise<{
    totalViews: number;
    viewsByDay: { date: string; count: number }[];
    eventsByType: { eventType: string; count: number }[];
  }> {
    await this.assertCanView(userId, venueId);

    const viewsQb = this.views
      .createQueryBuilder('v')
      .select(`to_char(date_trunc('day', v."viewedAt"), 'YYYY-MM-DD')`, 'date')
      .addSelect('COUNT(*)::int', 'count')
      .where('v."venueId" = :venueId', { venueId })
      .groupBy('date')
      .orderBy('date', 'ASC');
    this.applyDateRange(viewsQb, 'v."viewedAt"', from, to);
    const viewsByDay = await viewsQb.getRawMany<{
      date: string;
      count: number;
    }>();

    const eventsQb = this.eventsRepo
      .createQueryBuilder('e')
      .select('e."eventType"', 'eventType')
      .addSelect('COUNT(*)::int', 'count')
      .where('e."venueId" = :venueId', { venueId })
      .groupBy('e."eventType"')
      .orderBy('count', 'DESC');
    this.applyDateRange(eventsQb, 'e."occurredAt"', from, to);
    const eventsByType = await eventsQb.getRawMany<{
      eventType: string;
      count: number;
    }>();

    // total — сума тих самих днів (діапазон поважається, не просто last page)
    const totalViews = viewsByDay.reduce((sum, d) => sum + Number(d.count), 0);
    return { totalViews, viewsByDay, eventsByType };
  }

  async getOverview(): Promise<{
    totalViews: number;
    totalEvents: number;
    eventsByType: { eventType: string; count: number }[];
  }> {
    const totalViews = await this.views.count();
    const totalEvents = await this.eventsRepo.count();
    const eventsByType = await this.eventsRepo
      .createQueryBuilder('e')
      .select('e."eventType"', 'eventType')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('e."eventType"')
      .orderBy('count', 'DESC')
      .getRawMany<{ eventType: string; count: number }>();
    return { totalViews, totalEvents, eventsByType };
  }

  /** Перегляди по всій системі в розрізі часу (суперадмін). */
  async getTimeseries(opts: {
    from?: string;
    to?: string;
    granularity: Granularity;
  }): Promise<{ date: string; count: number }[]> {
    // granularity проходить whitelist-валідацію DTO (@IsIn) на межі HTTP —
    // сюди більше не може дійти довільна строка
    const qb = this.views
      .createQueryBuilder('v')
      .select(
        `to_char(date_trunc('${opts.granularity}', v."viewedAt"), 'YYYY-MM-DD')`,
        'date',
      )
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('date')
      .orderBy('date', 'ASC');
    this.applyDateRange(qb, 'v."viewedAt"', opts.from, opts.to);
    return qb.getRawMany<{ date: string; count: number }>();
  }

  /** Перегляди в розрізі закладів (суперадмін). */
  async getVenueStats(opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, offset } = normalizePagination(opts);
    const qb = this.views
      .createQueryBuilder('v')
      .select('v."venueId"', 'venueId')
      .addSelect('v2."name"', 'venueName')
      .addSelect('COUNT(*)::int', 'views')
      .leftJoin('venues', 'v2', 'v2."id" = v."venueId"')
      .groupBy('v."venueId"')
      .addGroupBy('v2."name"')
      .orderBy('views', 'DESC')
      .offset(offset)
      .limit(limit);
    this.applyDateRange(qb, 'v."viewedAt"', opts.from, opts.to);
    const data = await qb.getRawMany<{
      venueId: string;
      venueName: string | null;
      views: number;
    }>();

    const totalQb = this.views
      .createQueryBuilder('v')
      .select('COUNT(DISTINCT v."venueId")::int', 'total');
    this.applyDateRange(totalQb, 'v."viewedAt"', opts.from, opts.to);
    const row = await totalQb.getRawOne<{ total: number }>();
    return { data, meta: buildMeta({ page, limit, offset }, row?.total ?? 0) };
  }
}
