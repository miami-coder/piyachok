import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityManager, Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { PermissionsService } from '../rbac/permissions.service';
import { VenuesService } from '../venues/venues.service';
import { FileStorageService } from '../../common/services/file-storage.service';
import {
  REVIEW_CREATED,
  REVIEW_DELETED,
  REVIEW_UPDATED,
  type ReviewCreatedEvent,
  type ReviewDeletedEvent,
  type ReviewUpdatedEvent,
} from './events';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { sanitizeUser } from '../../common/utils/sanitize-user';
import { PG_CODES, isPgError } from '../../common/utils/pg-error.util';

/** Жодних приватних даних авторів у відповідях. */
function sanitizeReviewAuthors(data: Review[]) {
  return data.map((r) => ({
    ...r,
    user: sanitizeUser(r.user),
  }));
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    private readonly venuesService: VenuesService,
    private readonly perms: PermissionsService,
    private readonly events: EventEmitter2,
    private readonly storage: FileStorageService,
  ) {}

  /** Перевірка, що відгук на заклад взагалі можна створити:
   *  заклад існує, схвалений, не власний, дубліката немає.
   *  Викликається до будь-яких побічних ефектів (збереження файла). */
  async assertCanCreate(userId: string, venueId: string): Promise<void> {
    const venue = await this.venuesService.findByIdApprovedOrThrow(venueId);
    if (venue.ownerId === userId)
      throw new ForbiddenException(
        'Не можна залишати відгук на власний заклад',
      );
    const existing = await this.reviews.findOne({ where: { venueId, userId } });
    if (existing)
      throw new ConflictException('Ви вже залишили відгук на цей заклад');
  }

  /** Створення з побічним ефектом збереження фото чека: перевірки
   *  assertCanCreate виконуються один раз ПЕРЕД збереженням файла, а при
   *  падінні вставки (гонка дубліката) щойно збережений файл прибирається. */
  async create(
    userId: string,
    venueId: string,
    dto: CreateReviewDto,
    file?: Express.Multer.File,
  ): Promise<Review> {
    await this.assertCanCreate(userId, venueId);
    let stored: { url: string; filename: string } | undefined;
    let checkPhotoUrl: string | null = null;
    if (file) {
      stored = await this.storage.save(`reviews/${venueId}`, {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      });
      checkPhotoUrl = stored.url;
    }
    const review = this.reviews.create({
      venueId,
      userId,
      ...dto,
      checkPhotoUrl,
      billAmount: dto.billAmount ?? null,
    });
    try {
      const saved = await this.reviews.manager.transaction(async (em) => {
        const saved = await em.save(review);
        await this.recalc(venueId, em);
        return saved;
      });
      // Кеш каталогу після коміту (в транзакції скипати марно)
      await this.venuesService.invalidateCatalogCache();
      this.events.emit(REVIEW_CREATED, {
        reviewId: saved.id,
        venueId,
      } satisfies ReviewCreatedEvent);
      return saved;
    } catch (e) {
      // Файл чека не має лишатися сиротою, якщо вставка не відбулася.
      if (stored) {
        await this.storage
          .remove(`reviews/${venueId}`, stored.filename)
          .catch(() => undefined);
      }
      // Паралельний create двох відгуків з однієї пари (venueId, userId)
      // проскакує перевірку assertCanCreate — юнік-індекс ловить гонку.
      if (isPgError(e, PG_CODES.UNIQUE_VIOLATION)) {
        throw new ConflictException('Ви вже залишили відгук на цей заклад');
      }
      throw e;
    }
  }

  async update(
    userId: string,
    reviewId: string,
    dto: UpdateReviewDto,
  ): Promise<Review> {
    const review = await this.findOneOrThrow(reviewId);
    await this.perms.assertOwnerOrPermission(
      review.userId,
      userId,
      'review:edit:any',
      'Не можна редагувати цей відгук',
    );
    Object.assign(review, dto);
    await this.reviews.manager.transaction(async (em) => {
      await em.save(review);
      await this.recalc(review.venueId, em);
    });
    await this.venuesService.invalidateCatalogCache();
    this.events.emit(REVIEW_UPDATED, {
      reviewId,
      venueId: review.venueId,
    } satisfies ReviewUpdatedEvent);
    return review;
  }

  /** Мʼяке видалення: відгук лишається у базі з проставленим deletedAt
   *  (частковий унік-індекс пускає автору написати новий на той самий заклад),
   *  рейтинг перераховується без видаленого відгуку. */
  async softDelete(userId: string, reviewId: string): Promise<void> {
    const review = await this.findOneOrThrow(reviewId);
    await this.perms.assertOwnerOrPermission(
      review.userId,
      userId,
      'review:edit:any',
      'Не можна видалити цей відгук',
    );
    const venueId = review.venueId;
    await this.reviews.manager.transaction(async (em) => {
      await em.softDelete(Review, reviewId);
      await this.recalc(venueId, em);
    });
    await this.venuesService.invalidateCatalogCache();
    this.events.emit(REVIEW_DELETED, {
      reviewId,
      venueId,
    } satisfies ReviewDeletedEvent);
  }

  async findOneOrThrow(id: string): Promise<Review> {
    const r = await this.reviews.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Відгук не знайдено');
    return r;
  }

  async listForVenue(
    venueId: string,
    page = 1,
    limit = 20,
    sort: 'newest' | 'oldest' | 'highest' | 'lowest' = 'newest',
  ) {
    const { offset } = normalizePagination({ page, limit });
    const orderMap: Record<
      typeof sort,
      { column: 'createdAt' | 'rating'; dir: 'DESC' | 'ASC' }
    > = {
      newest: { column: 'createdAt', dir: 'DESC' },
      oldest: { column: 'createdAt', dir: 'ASC' },
      highest: { column: 'rating', dir: 'DESC' },
      lowest: { column: 'rating', dir: 'ASC' },
    };
    // sort приходить із query-рядка без рантайм-валідації: невідоме значення
    // або порожній рядок не мають ключа в orderMap — падаємо в дефолт.
    const order = orderMap[sort] ?? orderMap['newest'];
    const [data, total] = await this.reviews
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'u')
      .leftJoinAndSelect('u.profile', 'p')
      .where('r.venueId = :venueId', { venueId })
      .andWhere('r.deletedAt IS NULL')
      .orderBy('r.isFeatured', 'DESC')
      .addOrderBy(`r.${order.column}`, order.dir)
      .skip(offset)
      .take(limit)
      .getManyAndCount();
    return {
      data: sanitizeReviewAuthors(data),
      meta: buildMeta({ page, limit, offset }, total),
    };
  }

  async listForUser(userId: string) {
    return this.reviews.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Список усіх відгуків для адмінки (суперадмін). */
  async listAdmin(opts: { venueId?: string; page?: number; limit?: number }) {
    const { page, limit, offset } = normalizePagination(opts);
    const qb = this.reviews
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'u')
      .leftJoinAndSelect('u.profile', 'p')
      .leftJoinAndSelect('r.venue', 'v');
    if (opts.venueId)
      qb.where('r.venueId = :venueId', { venueId: opts.venueId });
    // Видалені відгуки не показуємо ніде, включно з адміністративним списком.
    qb.andWhere('r.deletedAt IS NULL');
    qb.orderBy('r.createdAt', 'DESC').skip(offset).take(limit);
    const [data, total] = await qb.getManyAndCount();
    return {
      data: sanitizeReviewAuthors(data),
      meta: buildMeta({ page, limit, offset }, total),
    };
  }

  async feature(reviewId: string) {
    const r = await this.findOneOrThrow(reviewId);
    r.isFeatured = true;
    return this.reviews.save(r);
  }

  async unfeature(reviewId: string) {
    const r = await this.findOneOrThrow(reviewId);
    r.isFeatured = false;
    return this.reviews.save(r);
  }

  /** Перерахунок статистики рейтингу в тій самій транзакції, що й запис
   *  відгуку: середнє по неопублікованих у сусідньому з'єднанні даних
   *  порахувало б старе значення. */
  private async recalc(venueId: string, em: EntityManager) {
    const result = await em
      .createQueryBuilder(Review, 'r')
      .select('AVG(r.rating)', 'avg')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.venueId = :venueId', { venueId })
      .andWhere('r.deletedAt IS NULL')
      .getRawOne<{ avg: string; count: string }>();
    // Поля закладу мутуємо тільки через venues.service — агрегат має
    // одного власника, прямий апдейт репозиторію оминав би його.
    await this.venuesService.updateRatingStats(
      venueId,
      {
        ratingAvg: Number(result?.avg ?? 0),
        ratingCount: Number(result?.count ?? 0),
      },
      em,
    );
  }
}
