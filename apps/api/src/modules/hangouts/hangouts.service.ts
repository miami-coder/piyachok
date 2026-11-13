import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import {
  Hangout,
  HangoutGender,
  HangoutPayer,
  HangoutStatus,
} from './entities/hangout.entity';
import { HangoutParticipant } from './entities/hangout-participant.entity';
import { CreateHangoutDto } from './dto/create-hangout.dto';
import { VenuesService } from '../venues/venues.service';
import { VenueStatus } from '../venues/entities/venue.entity';
import { sanitizeUser } from '../../common/utils/sanitize-user';
import { kyivWallToUtc } from '../../common/utils/kyiv-time.util';
import { CacheService } from '../../common/services/cache.service';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';

export const HANGOUT_FILLED = 'hangout.filled';
export const HANGOUT_CANCELLED = 'hangout.cancelled';

@Injectable()
export class HangoutsService {
  constructor(
    @InjectRepository(Hangout)
    private readonly hangouts: Repository<Hangout>,
    @InjectRepository(HangoutParticipant)
    private readonly participants: Repository<HangoutParticipant>,
    private readonly venues: VenuesService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {}

  async create(
    userId: string,
    venueId: string,
    dto: CreateHangoutDto,
  ): Promise<Hangout> {
    const venue = await this.venues.findOneOrThrow(venueId);
    if (venue.status !== VenueStatus.Approved)
      throw new ForbiddenException(
        'Пиячки можна створювати лише на схвалені заклади',
      );
    // Дата+час: «сьогодні о 00:01» — вже минуле, тільки
    // до початку дня перевірка це пропускала.
    // Час вводиться за Києвом (контейнер у UTC): без зони «сьогодні ввечері»
    // парсилось як UTC і виглядало майбутнім. Офсет для конкретної дати —
    // за правилами IANA Europe/Kyiv, тими ж, що й AT TIME ZONE 'Europe/Kyiv'
    // у кроні завершення: один джерело часу, влітку +3, взимку +2.
    const at = kyivWallToUtc(dto.date, dto.time);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000) {
      throw new BadRequestException(
        'Дата й час зустрічі мають бути у майбутньому',
      );
    }
    const h = this.hangouts.create({
      creatorId: userId,
      venueId,
      date: dto.date,
      time: dto.time,
      purpose: dto.purpose,
      gender: dto.gender ?? HangoutGender.Any,
      groupSize: dto.groupSize,
      payer: dto.payer ?? HangoutPayer.Split,
      desiredBudget: dto.desiredBudget ?? null,
      status: HangoutStatus.Open,
    });
    await this.hangouts.save(h);
    await this.participants.save({ hangoutId: h.id, userId });
    // create — така сама мутація стрічки, як join/leave/cancel/delete:
    // без скиду кешу новий запит не видний на /hangouts до кінця TTL
    await this.invalidateListCache();
    return h;
  }

  /** Гонка на останнє місце: без транзакції два паралельні join-и
   *  проходили перевірку count до вставки один одного і переповнювали
   *  заявку. FOR UPDATE на рядок заявки серіалізує join-и однієї заявки.
   *  PK (hangoutId, userId) — тиловий захист від подвійного join: 23505 → 409. */
  async join(userId: string, hangoutId: string): Promise<Hangout> {
    let filled = false;
    try {
      const h = await this.hangouts.manager.transaction(async (em) => {
        const hangout = await em.findOne(Hangout, {
          where: { id: hangoutId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!hangout) throw new NotFoundException('Заявку не знайдено');
        if (hangout.status !== HangoutStatus.Open) {
          throw new ConflictException('Заявка вже заповнена або скасована');
        }
        const existing = await em.findOne(HangoutParticipant, {
          where: { hangoutId, userId },
        });
        if (existing) throw new ConflictException('Ви вже приєднані');
        const count = await em.count(HangoutParticipant, {
          where: { hangoutId },
        });
        if (count >= hangout.groupSize) {
          throw new ConflictException('Заявка вже заповнена');
        }
        await em.save(HangoutParticipant, { hangoutId, userId });
        if (count + 1 >= hangout.groupSize) {
          hangout.status = HangoutStatus.Filled;
          await em.save(hangout);
          filled = true;
        }
        return hangout;
      });
      // Подія після коміту: слухачі бачать уже зафіксований стан
      if (filled) this.events.emit(HANGOUT_FILLED, { hangoutId });
      await this.invalidateListCache();
      return h;
    } catch (e) {
      if (
        typeof e === 'object' &&
        e !== null &&
        (e as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Ви вже приєднані');
      }
      throw e;
    }
  }

  async leave(userId: string, hangoutId: string): Promise<void> {
    const h = await this.findOneOrThrow(hangoutId);
    if (h.creatorId === userId) {
      const others = await this.participants.count({ where: { hangoutId } });
      if (others > 1) {
        throw new ForbiddenException(
          'Творець не може залишити, поки є інші учасники. Скасуйте заявку.',
        );
      }
    }
    const result = await this.participants.delete({ hangoutId, userId });
    // Неучасник (або хто вже вийшов) — явний 409 замість тихого 200
    if (!result.affected) {
      throw new ConflictException('Ви не учасник цієї зустрічі');
    }
    if (h.status === HangoutStatus.Filled) {
      h.status = HangoutStatus.Open;
      await this.hangouts.save(h);
    }
    await this.invalidateListCache();
  }

  /** Видалення запиту автором повністю: cancel лишає запис
   *  зі статусом cancelled — автор має право і стерти його зовсім. */
  async delete(userId: string, hangoutId: string): Promise<void> {
    const h = await this.findOneOrThrow(hangoutId);
    if (h.creatorId !== userId) {
      throw new ForbiddenException('Тільки творець може видалити запит');
    }
    await this.hangouts.delete(hangoutId);
    this.events.emit(HANGOUT_CANCELLED, { hangoutId, deleted: true });
    await this.invalidateListCache();
  }

  async cancel(userId: string, hangoutId: string): Promise<Hangout> {
    const h = await this.findOneOrThrow(hangoutId);
    if (h.creatorId !== userId) {
      throw new ForbiddenException('Тільки творець може скасувати');
    }
    // Повторне скасування: не зберігаємо вдруге і не шлемо подію ще раз
    if (h.status === HangoutStatus.Cancelled) {
      throw new ConflictException('Заявка вже скасована');
    }
    h.status = HangoutStatus.Cancelled;
    await this.hangouts.save(h);
    this.events.emit(HANGOUT_CANCELLED, { hangoutId });
    await this.invalidateListCache();
    return h;
  }

  async listPublic(opts: {
    venueId?: string;
    date?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, offset } = normalizePagination(opts);
    const cacheKey = `hangouts:list:${createHash('sha1').update(JSON.stringify(opts)).digest('hex')}`;
    // Кешуємо {data, total}, а не довжину сторінки — total на хіті
    // інакше рахується як кількість рядків сторінки.
    const cached = await this.cache.get<{ data: Hangout[]; total: number }>(
      cacheKey,
    );
    if (cached) {
      return {
        data: cached.data,
        meta: buildMeta({ page, limit, offset }, cached.total),
      };
    }
    const qb = this.hangouts
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.venue', 'v')
      .leftJoinAndSelect('v.photos', 'p')
      .leftJoin('h.participants', 'part')
      .addSelect('COUNT(part."userId")', 'participantsCount')
      .groupBy('h.id, v.id, p.id');
    if (opts.venueId)
      qb.andWhere('h.venueId = :venueId', { venueId: opts.venueId });
    if (opts.date) qb.andWhere('h.date = :date', { date: opts.date });
    if (opts.status) qb.andWhere('h.status = :status', { status: opts.status });
    else qb.andWhere('h.status = :status', { status: HangoutStatus.Open });
    qb.orderBy('h.date', 'ASC')
      .addOrderBy('h.time', 'ASC')
      .skip(offset)
      .take(limit);
    const [data, total] = await qb.getManyAndCount();
    await this.cache.set(cacheKey, { data, total }, 30);
    return { data, meta: buildMeta({ page, limit, offset }, total) };
  }

  /**
   * Деталі зустрічі — доступні будь-якому залогіненому користувачу (гейт
   * «тільки для учасників» знято: доєднатися можна лише побачивши деталі).
   * Учасники — з profile (імʼя/прізвище) і joinedAt; повний user/email
   * назовні не віддаємо (PII).
   */
  async getOne(hangoutId: string): Promise<
    Omit<Hangout, 'participants'> & {
      participants: {
        hangoutId: string;
        userId: string;
        joinedAt: Date;
        firstname: string;
        lastname: string;
      }[];
    }
  > {
    const h = await this.hangouts.findOne({
      where: { id: hangoutId },
      relations: { participants: { user: { profile: true } }, venue: true },
    });
    if (!h) throw new NotFoundException('Заявку не знайдено');
    return {
      ...h,
      participants: h.participants.map((p) => {
        const author = sanitizeUser(p.user);
        const authorProfile = (author?.profile ?? {}) as {
          firstname?: string;
          lastname?: string;
        };
        return {
          hangoutId: p.hangoutId,
          userId: p.userId,
          joinedAt: p.joinedAt,
          firstname: authorProfile.firstname ?? '',
          lastname: authorProfile.lastname ?? '',
        };
      }),
    };
  }

  async listMine(userId: string, role: 'created' | 'joined' | 'all') {
    if (role === 'created') {
      return this.hangouts.find({
        where: { creatorId: userId },
        order: { createdAt: 'DESC' },
      });
    }
    if (role === 'joined') {
      return this.hangouts
        .createQueryBuilder('h')
        .innerJoin('h.participants', 'p')
        .where('p.userId = :userId', { userId })
        .andWhere('h.creatorId != :userId', { userId })
        .getMany();
    }
    return this.hangouts
      .createQueryBuilder('h')
      .leftJoin('h.participants', 'p')
      .where(
        new Brackets((b) =>
          b
            .where('h.creatorId = :userId', { userId })
            .orWhere('p.userId = :userId', { userId }),
        ),
      )
      .getMany();
  }

  async findOneOrThrow(id: string): Promise<Hangout> {
    const h = await this.hangouts.findOne({ where: { id } });
    if (!h) throw new NotFoundException('Заявку не знайдено');
    return h;
  }

  async markCompletedBatch(): Promise<number> {
    const result = await this.hangouts
      .createQueryBuilder()
      .update()
      .set({ status: HangoutStatus.Completed })
      .where(
        `status IN ('open','filled') AND (date + time::time) AT TIME ZONE 'Europe/Kyiv' < NOW()`,
      )
      .execute();
    await this.invalidateListCache();
    return result.affected ?? 0;
  }

  async invalidateListCache() {
    await this.cache.delByPattern('hangouts:list:*');
  }
}
