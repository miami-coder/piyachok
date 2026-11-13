import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Venue, VenueStatus } from './entities/venue.entity';
import { VenuesService } from './venues.service';
import { RoleGrantsService } from '../rbac/role-grants.service';
import { USER_ROLE_ADDED } from '../rbac/listeners/user-role.listener';
import { RoleCode } from '../rbac/entities/role.enum';
import { AuditService } from '../admin/audit.service';
import { sanitizeUser } from '../../common/utils/sanitize-user';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { VENUE_STATUS_CHANGED, VenueStatusChangedEvent } from './events';

/**
 * Модеративний життєвий цикл закладу: списки модерації, апрув/відхилення,
 * передача керування власнику. Редакційні поля закладу тут не міняються —
 * це зона venues.service (ядро агрегату).
 */
@Injectable()
export class VenuesAdminService {
  constructor(
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
    private readonly venueService: VenuesService,
    private readonly roleGrants: RoleGrantsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

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
    const venue = await this.venueService.findOneOrThrow(venueId);
    const from = venue.status;
    venue.status = to;
    await this.venues.save(venue);
    this.events.emit(
      VENUE_STATUS_CHANGED,
      new VenueStatusChangedEvent(venueId, from, to),
    );
    return venue;
  }

  // Апрув: статус → approved + власник отримує роль venue_admin
  // (ідемпотентно). Атомарно: статус, роль і запис аудиту — в одній
  // транзакції (падіння видачі ролі відкочує статус, заклад не лишається
  // «схваленим без ролі власнику»). Події — після коміту.
  // Ручна видача ролей супер-адміном лишається незалежною.
  // Видалений (archived) заклад апрувнути не можна.
  async approve(actorId: string, venueId: string): Promise<Venue> {
    const current = await this.venueService.findOneOrThrow(venueId);
    if (current.status === VenueStatus.Archived)
      throw new ForbiddenException('Видалений заклад не можна підтвердити');
    const from = current.status;
    const { venue, roleGranted } = await this.venues.manager.transaction(
      async (em) => {
        current.status = VenueStatus.Approved;
        const venue = await em.save(current);
        const roleGranted = venue.ownerId
          ? await this.roleGrants.grant(venue.ownerId, RoleCode.VenueAdmin, {
              em,
            })
          : false;
        await this.audit.log(
          actorId,
          'venue_approve',
          'venue',
          venueId,
          null,
          { status: 'approved', ownerId: venue.ownerId, roleGranted },
          em,
        );
        return { venue, roleGranted };
      },
    );
    // Події після коміту: слухачі бачать уже зафіксований стан
    this.events.emit(
      VENUE_STATUS_CHANGED,
      new VenueStatusChangedEvent(venueId, from, VenueStatus.Approved),
    );
    if (roleGranted && venue.ownerId)
      // grant із чужим em подію не емітує — робимо це самі після коміту
      this.events.emit(USER_ROLE_ADDED, { userId: venue.ownerId });
    return venue;
  }

  /** Призначити власника (існування користувача перевіряє контролер через
   *  UsersService). Власник схваленого закладу ідемпотентно отримує
   *  venue_admin (як в approve), все атомарно в одній транзакції.
   *  Попереднього власника не чіпаємо — ручні видачі ролей незалежні. */
  async assignOwner(
    actorId: string,
    venueId: string,
    userId: string,
  ): Promise<Venue> {
    const venue = await this.venueService.findOneOrThrow(venueId);
    const before = venue.ownerId;
    const { saved, roleGranted } = await this.venues.manager.transaction(
      async (em) => {
        venue.ownerId = userId;
        const saved = await em.save(venue);
        const roleGranted =
          venue.status === VenueStatus.Approved
            ? await this.roleGrants.grant(userId, RoleCode.VenueAdmin, { em })
            : false;
        await this.audit.log(
          actorId,
          'venue_assign_owner',
          'venue',
          venueId,
          before ? { ownerId: before } : null,
          { ownerId: userId, roleGranted },
          em,
        );
        return { saved, roleGranted };
      },
    );
    if (roleGranted) this.events.emit(USER_ROLE_ADDED, { userId });
    return saved;
  }
}
