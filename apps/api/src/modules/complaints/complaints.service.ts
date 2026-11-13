import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Complaint, ComplaintStatus } from './entities/complaint.entity';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';
import { VenuesService } from '../venues/venues.service';
import { PermissionsService } from '../rbac/permissions.service';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';

@Injectable()
export class ComplaintsService {
  constructor(
    @InjectRepository(Complaint)
    private readonly complaints: Repository<Complaint>,
    private readonly venues: VenuesService,
    private readonly perms: PermissionsService,
  ) {}

  async create(userId: string, dto: CreateComplaintDto) {
    if (!dto.venueId && !dto.reviewId) {
      throw new BadRequestException(
        'Потрібно вказати venueId або reviewId скарги',
      );
    }
    const entity = this.complaints.create({
      userId,
      venueId: dto.venueId ?? null,
      reviewId: dto.reviewId ?? null,
      reason: dto.reason,
      text: dto.text,
      status: ComplaintStatus.New,
    });
    return this.complaints.save(entity);
  }

  async listPending(page = 1, limit = 20) {
    const { offset } = normalizePagination({ page, limit });
    const [data, total] = await this.complaints.findAndCount({
      where: { status: In([ComplaintStatus.New, ComplaintStatus.InReview]) },
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });
    return { data, meta: buildMeta({ page, limit, offset }, total) };
  }

  /** Хто бачить скарги закладу — той, хто має complaint:manage, або його
   *  власник. Перевірка живе тут, у сервісі, а не в контролері. */
  async assertCanViewForVenue(userId: string, venueId: string): Promise<void> {
    if (await this.perms.hasPermission(userId, 'complaint:manage')) return;
    const venue = await this.venues.findOneOrThrow(venueId);
    // право вже не пройшло вище — тут вирішує только володіння закладом
    await this.perms.assertOwnerOrPermission(
      venue.ownerId,
      userId,
      'complaint:manage',
      'Немає доступу до скарг цього закладу',
    );
  }

  /** Скарги до закладу для власника: ціль — сам заклад або відгук на нього. */
  async listForVenue(venueId: string, page = 1, limit = 20) {
    const { offset } = normalizePagination({ page, limit });
    const [data, total] = await this.complaints
      .createQueryBuilder('c')
      .leftJoin('c.review', 'r')
      .where('(c.venueId = :venueId OR r.venueId = :venueId)', { venueId })
      .andWhere('c.status IN (:...statuses)', {
        statuses: [ComplaintStatus.New, ComplaintStatus.InReview],
      })
      .orderBy('c.createdAt', 'ASC')
      .offset(offset)
      .limit(limit)
      .getManyAndCount();
    return { data, meta: buildMeta({ page, limit, offset }, total) };
  }

  async resolve(id: string, adminUserId: string, dto: ResolveComplaintDto) {
    const c = await this.complaints.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Скаргу не знайдено');
    // §4.4: повторний resolve не перезаписує чуже рішення
    if (
      c.status === ComplaintStatus.Resolved ||
      c.status === ComplaintStatus.Rejected
    ) {
      throw new ConflictException('Скаргу вже вирішено');
    }
    c.status = dto.status;
    c.resolvedBy = adminUserId;
    c.resolvedAt = new Date();
    return this.complaints.save(c);
  }
}
