import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { USER_ROLE_ADDED } from './listeners/user-role.listener';

/**
 * Ідемпотентна видача ролі за кодом.
 *
 * Єдине місце, куди модулі доменів (наприклад, venues: апрув закладу /
 * призначення власника) звертаються за видачею ролі — самі вони ролей не
 * зберігають. Роль, якої немає в системі, або яку користувач уже має — це
 * no-op (false), записи не дублюються.
 *
 * Скидання кешу пермішенів тут не робиться: UserRoleListener робить це за
 * подією user_role.added (та сама схема, що й в AdminUsersService).
 */
@Injectable()
export class RoleGrantsService {
  constructor(
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,
    private readonly events: EventEmitter2,
  ) {}

  /** true — роль щойно видана; false — вже була або ролі з таким кодом немає. */
  async grant(userId: string, roleCode: string): Promise<boolean> {
    const role = await this.roles.findOne({ where: { code: roleCode } });
    if (!role) return false;
    const existing = await this.userRoles.findOne({
      where: { userId, roleId: role.id },
    });
    if (existing) return false;
    await this.userRoles.save({ userId, roleId: role.id });
    // подію емітуємо лише при реальній видачі — при no-op кеш чіпати не треба
    this.events.emit(USER_ROLE_ADDED, { userId });
    return true;
  }
}
