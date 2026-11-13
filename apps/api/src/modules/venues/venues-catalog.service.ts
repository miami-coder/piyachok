import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Venue, VenueStatus } from './entities/venue.entity';
import { QueryVenuesDto, VenueSort } from './dto/query-venues.dto';
import { CacheService } from '../../common/services/cache.service';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';

/** CSV «wifi, parking» → [ 'wifi', 'parking' ] (пробіли по краях зріжувати). */
function csvCodes(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Екранування % та _ для ILIKE: вони не wildcard, а літерали. */
function escapeLike(input: string): string {
  return input.replace(/[!%_\\]/g, (ch) => `!${ch}`);
}

/**
 * Публічний каталог закладів: пошук з фільтрами, сортуванням і кешем.
 *
 * Read-модель над Venue: сама мутації не робить, а лише читає. Кінцеві
 * мутації агрегату, які впливають на видачу каталогу (рейтинг,
 * рекомендації, створення/редагування/статус через події), скидають кеш
 * списку через invalidateListCache().
 */
@Injectable()
export class VenuesCatalogService {
  /** Кешований ключ усіх сторінок списку (закінчується у хеш запиту). */
  private static readonly LIST_CACHE_PATTERN = 'venues:list:*';

  constructor(
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
    private readonly cache: CacheService,
  ) {}

  async search(query: QueryVenuesDto) {
    const { page, limit, offset } = normalizePagination(query);
    const cacheKey = `venues:list:${this.hashQuery(query)}`;
    const cached = await this.cache.get<{ data: Venue[]; total: number }>(
      cacheKey,
    );
    if (cached) {
      // cached.data — це вже сторінка (ключ включає page); повторне
      // зріжування робило повторні сторінки порожніми.
      return {
        data: cached.data,
        meta: buildMeta({ page, limit, offset }, cached.total),
      };
    }

    const qb = this.venues
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.photos', 'photo')
      .leftJoinAndSelect('v.featureAssignments', 'fa')
      .leftJoinAndSelect('fa.feature', 'f')
      .leftJoinAndSelect('v.venueTags', 'vt')
      .leftJoinAndSelect('vt.tag', 't')
      .leftJoinAndSelect('v.venueTypeAssignments', 'vta')
      .leftJoinAndSelect('vta.type', 'ty')
      .where('v.status = :status', { status: VenueStatus.Approved });

    if (query.q) {
      // % и _ — літерали, не wildcard
      const safe = `%${escapeLike(query.q)}%`;
      qb.andWhere(
        new Brackets((b) =>
          b
            .where(`v.name ILIKE :q ESCAPE '!'`, { q: safe })
            .orWhere(`v.address ILIKE :q ESCAPE '!'`, { q: safe }),
        ),
      );
    }
    if (query.minRating != null)
      qb.andWhere('v.ratingAvg >= :minRating', { minRating: query.minRating });
    if (query.minCheck != null)
      qb.andWhere('v.averageCheck >= :minCheck', { minCheck: query.minCheck });
    if (query.maxCheck != null)
      qb.andWhere('v.averageCheck <= :maxCheck', { maxCheck: query.maxCheck });
    if (query.feature) {
      // AND-семантика: заклад має ВСІ запитані фічі —
      // окремий EXISTS-підзапит на кожен код, а не один IN (OR).
      for (const [i, code] of csvCodes(query.feature).entries()) {
        const key = `feature_${i}`;
        qb.andWhere(
          `EXISTS (SELECT 1 FROM venue_feature_assignments fa2 JOIN venue_features f2 ON f2.id = fa2."featureId" WHERE fa2."venueId" = v.id AND f2.code = :${key})`,
          { [key]: code },
        );
      }
    }
    if (query.tag) {
      // AND-семантика для тегів — так само
      for (const [i, slug] of csvCodes(query.tag).entries()) {
        const key = `tag_${i}`;
        qb.andWhere(
          `EXISTS (SELECT 1 FROM venue_tags vt2 JOIN tags t2 ON t2.id = vt2."tagId" WHERE vt2."venueId" = v.id AND t2.slug = :${key})`,
          { [key]: slug },
        );
      }
    }
    if (query.type) qb.andWhere('ty.slug = :type', { type: query.type });
    if (query.recommended)
      // «Рекомендовані критиком» (секція на /top): критик-прапор на закладі.
      qb.andWhere('v.recommendedBy IS NOT NULL');
    if (query.lat != null && query.lng != null && query.radiusKm != null) {
      qb.andWhere(
        `ST_DWithin(v.location, ST_MakePoint(:lng, :lat)::geography, :meters)`,
        { lng: query.lng, lat: query.lat, meters: query.radiusKm * 1000 },
      );
    }

    const sort: VenueSort = query.sort ?? 'newest';
    switch (sort) {
      case 'rating':
        qb.orderBy('v.ratingAvg', 'DESC', 'NULLS LAST').addOrderBy(
          'v.ratingCount',
          'DESC',
        );
        break;
      case 'check':
        qb.orderBy('v.averageCheck', 'ASC', 'NULLS LAST');
        break;
      case 'name':
        qb.orderBy('v.name', 'ASC');
        break;
      case 'distance':
        if (query.lat != null && query.lng != null) {
          // Параметри у raw-виразі addSelect підставляються лише якщо вони
          // зареєстровані в іменованих параметрах запиту. Без radiusKm вони
          // ніде не появлялись — у SQL лишалось сире ST_MakePoint(:lng, :lat)
          // і Postgres віддавав «syntax error at or near ":"» (500).
          qb.setParameters({ lng: query.lng, lat: query.lat });
          qb.addSelect(
            `ST_Distance(v.location, ST_MakePoint(:lng, :lat)::geography)`,
            'distance',
          ).orderBy('distance', 'ASC');
        } else {
          qb.orderBy('v.createdAt', 'DESC');
        }
        break;
      case 'newest':
      default:
        qb.orderBy('v.createdAt', 'DESC');
    }
    qb.skip(offset).take(limit);

    const [rows, total] = await qb.getManyAndCount();
    await this.cache.set(cacheKey, { data: rows, total }, 60);
    return { data: rows, meta: buildMeta({ page, limit, offset }, total) };
  }

  /** Скидання кешу списку: викликається мутаціями агрегату та слушачем подій. */
  async invalidateListCache(): Promise<void> {
    await this.cache.delByPattern(VenuesCatalogService.LIST_CACHE_PATTERN);
  }

  private hashQuery(q: QueryVenuesDto): string {
    return createHash('sha1').update(JSON.stringify(q)).digest('hex');
  }
}
