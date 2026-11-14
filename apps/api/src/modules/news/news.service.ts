import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News, NewsStatus } from './entities/news.entity';
import { VenueStatus } from '../venues/entities/venue.entity';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { VenuesService } from '../venues/venues.service';
import { PermissionsService } from '../rbac/permissions.service';
import { FileStorageService } from '../../common/services/file-storage.service';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';

@Injectable()
export class NewsService {
  constructor(
    @InjectRepository(News) private readonly news: Repository<News>,
    private readonly venues: VenuesService,
    private readonly perms: PermissionsService,
    private readonly storage: FileStorageService,
  ) {}

  async createForVenue(userId: string, venueId: string, dto: CreateNewsDto) {
    const venue = await this.venues.findOneOrThrow(venueId);
    await this.perms.assertOwnerOrPermission(
      venue.ownerId,
      userId,
      'news:manage:any',
      'Не можна керувати новинами цього закладу',
    );
    return this.save(dto, venueId, userId);
  }

  // Глобальні новини створюються лише через адмін-роут (news:manage:any) —
  // гвард вже пропустив адміна, тому canPromoteFromCaller тут правомірний.
  async createGlobal(dto: CreateNewsDto) {
    return this.save(dto, null, undefined, true);
  }

  private async save(
    dto: CreateNewsDto,
    venueId: string | null,
    userId?: string,
    canPromoteFromCaller = false,
  ) {
    const canPromote =
      canPromoteFromCaller ||
      (!!userId && (await this.perms.hasPermission(userId, 'news:manage:any')));
    const now = new Date();
    const entity = this.news.create({
      venueId,
      category: dto.category,
      title: dto.title,
      content: dto.content,
      imageUrl: dto.imageUrl ?? null,
      status: dto.status ?? NewsStatus.Published,
      // «Просунута» новина — лише супер-адміну
      isPromoted: canPromote ? (dto.isPromoted ?? false) : false,
      publishedAt: now,
    });
    return this.news.save(entity);
  }

  async listPublic(opts: {
    category?: string;
    venueId?: string;
    page?: number;
    limit?: number;
    isPromoted?: boolean;
  }) {
    const { page, limit, offset } = normalizePagination(opts);
    const qb = this.news
      .createQueryBuilder('n')
      .leftJoin('n.venue', 'v')
      .where('n.status = :status', { status: NewsStatus.Published });
    // Новини схованого (pending/archived) закладу публічно не видимі.
    qb.andWhere('(n.venueId IS NULL OR v.status = :approved)', {
      approved: VenueStatus.Approved,
    });
    if (opts.category)
      qb.andWhere('n.category = :category', { category: opts.category });
    if (opts.venueId)
      qb.andWhere('n.venueId = :venueId', { venueId: opts.venueId });
    if (opts.isPromoted) qb.andWhere('n.isPromoted = true');
    qb.orderBy('n.isPromoted', 'DESC')
      .addOrderBy('n.publishedAt', 'DESC')
      .skip(offset)
      .take(limit);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: buildMeta({ page, limit, offset }, total) };
  }

  /** Список новин власника за всіма його закладами — будь-якого статусу
   *  закладу (власник не втрачає доступ до своїх новин схованого закладу,
   *  до схвалення закладу доступ до новин втрачався). */
  async listMine(userId: string, page = 1, limit = 20) {
    const {
      page: p,
      limit: l,
      offset,
    } = normalizePagination({
      page,
      limit,
    });
    const myVenues = await this.venues.listMineForUser(userId);
    if (myVenues.length === 0)
      return { data: [], meta: buildMeta({ page: p, limit: l, offset: 0 }, 0) };
    const qb = this.news
      .createQueryBuilder('n')
      .where('n.venueId IN (:...ids)', {
        ids: myVenues.map((v) => v.id),
      })
      .orderBy('n.publishedAt', 'DESC')
      .skip(offset)
      .take(l);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: buildMeta({ page: p, limit: l, offset }, total) };
  }

  /** Список новин для адмінки: без status — усі статуси, зі status — фільтр за ним. */
  async listAdmin(opts: {
    category?: string;
    venueId?: string;
    page?: number;
    limit?: number;
    isPromoted?: boolean;
    status?: NewsStatus;
  }) {
    const { page, limit, offset } = normalizePagination(opts);
    const qb = this.news.createQueryBuilder('n');
    if (opts.status) qb.where('n.status = :status', { status: opts.status });
    if (opts.category)
      qb.andWhere('n.category = :category', { category: opts.category });
    if (opts.venueId)
      qb.andWhere('n.venueId = :venueId', { venueId: opts.venueId });
    if (opts.isPromoted) qb.andWhere('n.isPromoted = true');
    qb.orderBy('n.isPromoted', 'DESC')
      .addOrderBy('n.publishedAt', 'DESC')
      .skip(offset)
      .take(limit);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: buildMeta({ page, limit, offset }, total) };
  }

  /** Публічний перегляд новини: тільки Published і тільки
   *  для схваленого закладу (глобальні — venueId відсутній). */
  async getPublic(id: string) {
    const n = await this.get(id);
    if (n.status !== NewsStatus.Published)
      throw new NotFoundException('Новину не знайдено');
    if (n.venueId) {
      // Несхвалений заклад не «підтверджує» існування новини для клієнта —
      // та сама маска 404, що й на публічному читанні закладу.
      await this.venues.findByIdApprovedOrThrow(
        n.venueId,
        'Новину не знайдено',
      );
    }
    return n;
  }

  async get(id: string) {
    const n = await this.news.findOne({ where: { id } });
    if (!n) throw new NotFoundException('Новину не знайдено');
    return n;
  }

  async update(id: string, userId: string, dto: UpdateNewsDto) {
    const n = await this.get(id);
    await this.assertCanManage(userId, n);
    // Юзер без news:manage:any не може міняти «просунутий» прапор:
    // ключ просто не застосовується (і не знімає існуючий прапор).
    const { isPromoted: promotedPatch, ...rest } = dto;
    Object.assign(n, rest);
    if (
      promotedPatch !== undefined &&
      (await this.perms.hasPermission(userId, 'news:manage:any'))
    ) {
      n.isPromoted = promotedPatch;
    }
    return this.news.save(n);
  }

  async softDelete(id: string, userId: string) {
    const n = await this.get(id);
    await this.assertCanManage(userId, n);
    n.status = NewsStatus.Archived;
    return this.news.save(n);
  }

  /** Завантажити фото новини: файл у storage + imageUrl. */
  async uploadPhoto(
    id: string,
    userId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    const n = await this.get(id);
    await this.assertCanManage(userId, n);
    const stored = await this.storage.save(`news/${id}`, file);
    n.imageUrl = stored.url;
    await this.news.save(n);
    return stored;
  }

  /**
   * Керувати новиною може власник закладу новини або той,
   * хто має news:manage:any. Глобальні (платформені) новини —
   * лише news:manage:any.
   */
  private async assertCanManage(userId: string, news: News) {
    if (!news.venueId)
      throw new ForbiddenException('Немає дозволу news:manage:any');
    const venue = await this.venues.findOneOrThrow(news.venueId);
    await this.perms.assertOwnerOrPermission(
      venue.ownerId,
      userId,
      'news:manage:any',
      'Не можна керувати новинами цього закладу',
    );
  }
}
