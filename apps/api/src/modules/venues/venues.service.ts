import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Venue, VenueStatus } from './entities/venue.entity';
import { VenuePhoto } from './entities/venue-photo.entity';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { sanitizeUser } from '../../common/utils/sanitize-user';
import { VenueTaxonomyService } from './venues-taxonomy.service';
import { VenuesCatalogService } from './venues-catalog.service';
import { PermissionsService } from '../rbac/permissions.service';
import { RoleGrantsService } from '../rbac/role-grants.service';
import { RoleCode } from '../rbac/entities/role.enum';
import { AuditService } from '../admin/audit.service';
import { FileStorageService } from '../../common/services/file-storage.service';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import {
  VENUE_CREATED,
  VENUE_STATUS_CHANGED,
  VENUE_UPDATED,
  VenueCreatedEvent,
  VenueStatusChangedEvent,
  VenueUpdatedEvent,
} from './events';

/** Показові поля закладу для карток у чужих списках (наприклад, вподобання). */
export type VenueCard = Pick<
  Venue,
  'id' | 'name' | 'address' | 'ratingAvg' | 'mainPhotoUrl'
>;

@Injectable()
export class VenuesService {
  constructor(
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
    @InjectRepository(VenuePhoto)
    private readonly photos: Repository<VenuePhoto>,
    private readonly taxonomy: VenueTaxonomyService,
    private readonly catalog: VenuesCatalogService,
    private readonly perms: PermissionsService,
    private readonly roleGrants: RoleGrantsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly storage: FileStorageService,
  ) {}

  async create(ownerId: string, dto: CreateVenueDto): Promise<Venue> {
    // Супер-адмін (venue:moderate) створює заклад одразу схваленим
    const autoApprove = await this.perms.hasPermission(
      ownerId,
      'venue:moderate',
    );
    const venue = this.venues.create({
      ownerId,
      name: dto.name,
      description: dto.description ?? null,
      address: dto.address,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      contacts: dto.contacts ?? {},
      workingHours: dto.workingHours ?? {},
      averageCheck: dto.averageCheck ?? null,
      status: autoApprove ? VenueStatus.Approved : VenueStatus.Pending,
    });
    // Фічі/теги/тип валідуємо ДО збереження: невідомий код/слаг — 400, щоб
    // не лишати напівстворений заклад без прив'язок.
    const [features, tags, type] = await Promise.all([
      this.taxonomy.resolveFeatures(dto.featureCodes ?? []),
      this.taxonomy.resolveTags(dto.tagSlugs ?? []),
      this.taxonomy.resolveType(dto.typeSlug),
    ]);
    await this.venues.save(venue);
    await this.taxonomy.writeFeatures(venue.id, features);
    await this.taxonomy.writeTags(venue.id, tags);
    await this.taxonomy.writeType(venue.id, type);
    this.events.emit(VENUE_CREATED, new VenueCreatedEvent(venue.id));
    return venue;
  }

  async update(
    userId: string,
    venueId: string,
    dto: UpdateVenueDto,
  ): Promise<Venue> {
    const venue = await this.findOneOrThrow(venueId);
    await this.assertCanEdit(userId, venue);

    // Обов'язкові поля: відсутнє/null не міняє старе (очищати не можна).
    venue.name = dto.name ?? venue.name;
    venue.address = dto.address ?? venue.address;

    // Опційні поля: «ключ присутній у запиті» = записати нове значення, при
    // цьому явний null (або порожній рядок після тріму) записує NULL у базу;
    // відсутній ключ = поле не чіпаємо. Відмінність null-від-відсутності —
    // єдиний спосіб очистити опційне поле через PATCH.
    if ('description' in dto) {
      const d = dto.description?.trim();
      venue.description = d ? d : null;
    }
    if ('latitude' in dto) venue.latitude = dto.latitude ?? null;
    if ('longitude' in dto) venue.longitude = dto.longitude ?? null;
    if ('contacts' in dto)
      venue.contacts = this.pickNonEmpty(dto.contacts ?? {});
    if ('workingHours' in dto)
      venue.workingHours = this.pickNonEmpty(dto.workingHours ?? {});
    if ('averageCheck' in dto) venue.averageCheck = dto.averageCheck ?? null;

    // Набірні поля: ключ присутній — замінюємо набір повністю (порожній
    // масив/порожній рядок/null = очистити), невідомі коди/слаги — 400.
    // Валідація до запису: 400 не залишає заклад із знятими прив'язками.
    const features =
      'featureCodes' in dto
        ? await this.taxonomy.resolveFeatures(dto.featureCodes ?? [])
        : undefined;
    const tags =
      'tagSlugs' in dto
        ? await this.taxonomy.resolveTags(dto.tagSlugs ?? [])
        : undefined;
    const type =
      'typeSlug' in dto
        ? await this.taxonomy.resolveType(dto.typeSlug)
        : undefined;
    if (features) await this.taxonomy.writeFeatures(venue.id, features);
    if (tags) await this.taxonomy.writeTags(venue.id, tags);
    if (type !== undefined) await this.taxonomy.writeType(venue.id, type);

    await this.venues.save(venue);
    this.events.emit(VENUE_UPDATED, new VenueUpdatedEvent(venue.id));
    return venue;
  }

  /** Об'єкт без порожніх ключів: строкові значення трімуємо, пусті/null
   *  видаляємо (очищення конкретного контакту або дня тижня через PATCH). */
  private pickNonEmpty<T extends object>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const s = v.trim();
        if (s) out[k] = s;
      } else if (v !== null && v !== undefined) {
        out[k] = v;
      }
    }
    return out as T;
  }

  /** Призначити власника (існування користувача перевіряє контролер через
   *  UsersService). Власник схваленого закладу ідемпотентно отримує
   *  venue_admin (як в approve), операція фіксується в аудиті.
   *  Попереднього власника не чіпаємо — ручні видачі ролей незалежні. */
  async assignOwner(
    actorId: string,
    venueId: string,
    userId: string,
  ): Promise<Venue> {
    const venue = await this.findOneOrThrow(venueId);
    const before = venue.ownerId;
    venue.ownerId = userId;
    const saved = await this.venues.save(venue);
    const roleGranted =
      venue.status === VenueStatus.Approved
        ? await this.roleGrants.grant(userId, RoleCode.VenueAdmin)
        : false;
    await this.audit.log(
      actorId,
      'venue_assign_owner',
      'venue',
      venueId,
      before ? { ownerId: before } : null,
      { ownerId: userId, roleGranted },
    );
    return saved;
  }

  async softDelete(userId: string, venueId: string): Promise<void> {
    const venue = await this.findOneOrThrow(venueId);
    await this.assertCanEdit(userId, venue);
    venue.status = VenueStatus.Archived;
    await this.venues.save(venue);
    this.events.emit(
      VENUE_STATUS_CHANGED,
      new VenueStatusChangedEvent(venue.id, 'approved', 'archived'),
    );
  }

  async findOneOrThrow(id: string): Promise<Venue> {
    const venue = await this.venues.findOne({ where: { id } });
    if (!venue) throw new NotFoundException('Заклад не знайдено');
    return venue;
  }

  /**
   * Єдине правило API «дії та публічне читання — лише зі схваленими
   * закладами»: неіснуючий або несхвалений заклад для клієнта виглядає
   * як неіснуючий (404), бо його немає в публічних списках.
   */
  async findByIdApprovedOrThrow(
    id: string,
    notFoundMessage = 'Заклад не знайдено',
  ): Promise<Venue> {
    const venue = await this.findOneOrThrow(id);
    if (venue.status !== VenueStatus.Approved)
      throw new NotFoundException(notFoundMessage);
    return venue;
  }

  async findOnePublic(id: string): Promise<Venue> {
    const venue = await this.venues
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.owner', 'o')
      .leftJoinAndSelect('o.profile', 'p')
      .where('v.id = :id', { id })
      .andWhere('v.status = :status', { status: VenueStatus.Approved })
      .getOne();
    if (!venue) throw new NotFoundException('Заклад не знайдено');
    if (venue.owner) venue.owner = sanitizeUser(venue.owner) as Venue['owner'];
    return venue;
  }

  async listMineForUser(userId: string): Promise<Venue[]> {
    return this.venues.find({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
      relations: { photos: true },
    });
  }

  /** Заклади, які поточний критик рекомендував (для вкладки в кабінеті). */
  async listRecommendedByUser(userId: string): Promise<Venue[]> {
    return this.venues
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.photos', 'photo')
      .leftJoinAndSelect('v.venueTags', 'vt')
      .leftJoinAndSelect('vt.tag', 't')
      .leftJoinAndSelect('v.venueTypeAssignments', 'vta')
      .leftJoinAndSelect('vta.type', 'ty')
      .where('v.recommendedBy = :userId', { userId })
      .orderBy('v.recommendedAt', 'DESC')
      .getMany();
  }

  /**
   * Рекомендація критика: 1 критик на заклад. Ставимо/відновлюємо свою
   * рекомендацію; попередня (чужа) перезаписується — поле одне.
   */
  async recommend(userId: string, venueId: string): Promise<Venue> {
    if (!(await this.perms.hasPermission(userId, 'venue:recommend')))
      throw new ForbiddenException('Немає дозволу venue:recommend');
    const venue = await this.findByIdApprovedOrThrow(venueId);
    venue.recommendedBy = userId;
    venue.recommendedAt = new Date();
    const saved = await this.venues.save(venue);
    await this.catalog.invalidateListCache();
    return saved;
  }

  /** Зняти рекомендацію — може лише критик, який її поставив. */
  async unrecommend(userId: string, venueId: string): Promise<Venue> {
    if (!(await this.perms.hasPermission(userId, 'venue:recommend')))
      throw new ForbiddenException('Немає дозволу venue:recommend');
    const venue = await this.findOneOrThrow(venueId);
    if (venue.recommendedBy && venue.recommendedBy !== userId)
      throw new ForbiddenException(
        'Зняти рекомендацію може лише критик, який її поставив',
      );
    venue.recommendedBy = null;
    venue.recommendedAt = null;
    const saved = await this.venues.save(venue);
    await this.catalog.invalidateListCache();
    return saved;
  }

  async findOneForOwnerQuery(id: string): Promise<Venue | null> {
    // Те саме насичення, що в search(): photos + features + tags + types.
    // Привʼязки (fa/vt/vta) обовʼязково з andSelect: без вибірки власних
    // колонок TypeORM не гідрує батьківський об'єкт — у JSON не потрапляв
    // ані venueTypeAssignments, ані featureAssignments (лишались only photos).
    return this.venues
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.photos', 'photo')
      .leftJoinAndSelect('v.featureAssignments', 'fa')
      .leftJoinAndSelect('fa.feature', 'f')
      .leftJoinAndSelect('v.venueTags', 'vt')
      .leftJoinAndSelect('vt.tag', 't')
      .leftJoinAndSelect('v.venueTypeAssignments', 'vta')
      .leftJoinAndSelect('vta.type', 'ty')
      .where('v.id = :id', { id })
      .getOne();
  }

  async findPending(page = 1, limit = 20) {
    const { offset } = normalizePagination({ page, limit });
    const [rows, total] = await this.venues.findAndCount({
      where: { status: VenueStatus.Pending },
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
      // Адмін має бачити заявку цілком: власник, фото, тип/теги/фічі
      relations: {
        owner: { profile: true },
        photos: true,
        featureAssignments: { feature: true },
        venueTags: { tag: true },
        venueTypeAssignments: { type: true },
      },
    });
    return { data: rows, meta: buildMeta({ page, limit, offset }, total) };
  }

  async findApproved(page = 1, limit = 20) {
    const { offset } = normalizePagination({ page, limit });
    const [rows, total] = await this.venues.findAndCount({
      where: { status: VenueStatus.Approved },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
      // Для передачі керування потрібен лише поточний власник
      relations: { owner: { profile: true } },
    });
    const data = rows.map((v) => {
      if (v.owner) v.owner = sanitizeUser(v.owner) as Venue['owner'];
      return v;
    });
    return { data, meta: buildMeta({ page, limit, offset }, total) };
  }

  async changeStatus(venueId: string, to: VenueStatus): Promise<Venue> {
    const venue = await this.findOneOrThrow(venueId);
    const from = venue.status;
    venue.status = to;
    await this.venues.save(venue);
    this.events.emit(
      VENUE_STATUS_CHANGED,
      new VenueStatusChangedEvent(venueId, from, to),
    );
    return venue;
  }

  // Апрув: статус → approved + власник отримує роль venue_admin (ідемпотентно).
  // Ручна видача ролей супер-адміном лишається незалежною.
  // Видалений (archived) заклад апрувнути не можна.
  async approve(actorId: string, venueId: string): Promise<Venue> {
    const current = await this.findOneOrThrow(venueId);
    if (current.status === VenueStatus.Archived)
      throw new ForbiddenException('Видалений заклад не можна підтвердити');
    const venue = await this.changeStatus(venueId, VenueStatus.Approved);
    const roleGranted = venue.ownerId
      ? await this.roleGrants.grant(venue.ownerId, RoleCode.VenueAdmin)
      : false;
    await this.audit.log(actorId, 'venue_approve', 'venue', venueId, null, {
      status: 'approved',
      ownerId: venue.ownerId,
      roleGranted,
    });
    return venue;
  }

  /** Агрегат «Заклад» має одного власника: мутації його полів із сусідніх
   *  сервісів (відгуки, аналітика) йдуть тільки через методи нижче, а не
   *  прямим апдейтом репозиторію — інакше зміни оминали б інвалідацію
   *  кешу списку, який сортується за ratingAvg. */
  async updateRatingStats(
    venueId: string,
    stats: { ratingAvg: number; ratingCount: number },
  ): Promise<void> {
    await this.venues.update(venueId, stats);
    await this.catalog.invalidateListCache();
  }

  /** Лічильник переглядів кеш списку навмисно не скидає: viewCount не
   *  бере участі в сортуванні каталогу, а перегляди частіші за запити
   *  списку — інвалідація на кожен перегляд убила б кеш узагалі. */
  async incrementViewCount(venueId: string): Promise<void> {
    await this.venues.increment({ id: venueId }, 'viewCount', 1);
  }

  /** Карта закладу для чужих списків: тільки показові поля, у тому самому
   *  порядку, що й вхідні id; неіснуючі id просто відкидаються. */
  async getCardsByIds(ids: string[]): Promise<VenueCard[]> {
    if (ids.length === 0) return [];
    const rows: Venue[] = await this.venues.find({
      where: { id: In(ids) },
      select: {
        id: true,
        name: true,
        address: true,
        ratingAvg: true,
        mainPhotoUrl: true,
      },
    });
    const byId = new Map<string, Venue>(rows.map((v) => [v.id, v]));
    const cards: VenueCard[] = [];
    for (const id of ids) {
      const v = byId.get(id);
      if (v) cards.push(v);
    }
    return cards;
  }

  private async assertCanEdit(userId: string, venue: Venue) {
    if (venue.ownerId === userId) return;
    if (await this.perms.hasPermission(userId, 'venue:edit:any')) return;
    throw new ForbiddenException('Не можна редагувати цей заклад');
  }

  // Завантаження фото: файл у storage + запис у venue_photos (без цього фото
  // ніде не показувалось би) + mainPhotoUrl для першого фото.
  async uploadPhoto(
    userId: string,
    venueId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ): Promise<{ url: string; filename: string; size: number }> {
    const venue = await this.findOneOrThrow(venueId);
    await this.assertCanEdit(userId, venue);
    const stored = await this.storage.save(`venues/${venueId}`, file);
    const sortOrder = await this.photos.count({ where: { venueId } });
    await this.photos.insert({
      venueId,
      url: stored.url,
      sortOrder,
    });
    if (!venue.mainPhotoUrl) {
      venue.mainPhotoUrl = stored.url;
      await this.venues.save(venue);
    }
    return stored;
  }
}
