import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(
    @InjectRepository(AuditLog)
    private readonly audit: Repository<AuditLog>,
  ) {}

  /** Запис у аудит. em — транзакція викликача: тоді запис аудиту атомарний
   *  з самою операцією (схвалення без запису в аудит не фіксується —
   *  провал аудиту відкочує операцію). Без em — звичайний запис. */
  async log(
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    before: object | null = null,
    after: object | null = null,
    em?: EntityManager,
  ): Promise<AuditLog> {
    const mgr = em ?? this.audit.manager;
    const entry = await mgr.save(AuditLog, {
      actorId,
      action,
      entityType,
      entityId,
      before,
      after,
    });
    this.logger.log(
      `audit:${action} on ${entityType}:${entityId ?? '*'} by ${actorId ?? 'system'}`,
    );
    return entry;
  }
}
