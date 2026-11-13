import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityManager, Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { USER_ROLE_ADDED } from './listeners/user-role.listener';

/**
 * Ідемпотентна видача ролі за кодом.
 *
 * Єдине місце, яке пише UserRole в рантаймі: модулі доменів (venues: апрув
 * закладу / призначення власника), адмін-керування юзерами та реєстрація.
 * Роль, яку користувач уже має, — це no-op (false), записи не дублюються.
 *
 * Скидання кешу пермішенів тут не робиться: UserRoleListener робить це за
 * подією user_role.added.
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

  /**
   * true — роль щойно видана; false — вже була або ролі з таким кодом немає.
   * assignedBy — хто видав (адмін із панелі); для системних видач
   * (реєстрація, апрув закладу) передається як null/undefined.
   *
   * opts.em — транзакція викликача: запис іде через неї, атомарно з операцією
   * викликача (апрув закладу, реєстрація). Тоді подію user_role.added НЕ
   * емітуємо: слухач інвалідує кеш пермішенів читанням із бази, а всередині
   * невідкритої транзакції ролі там ще немає — кеш запомнить порожній стан.
   * Викликач емітує подію сам після коміту. Без em (безтранзакційний виклик)
   * подія емітується звідси як і раніше.
   */
  async grant(
    userId: string,
    roleCode: string,
    opts?: { assignedBy?: string | null; em?: EntityManager },
  ): Promise<boolean> {
    const role = await this.roles.findOne({ where: { code: roleCode } });
    if (!role) return false;
    const existing = await this.userRoles.findOne({
      where: { userId, roleId: role.id },
    });
    if (existing) return false;
    const values = {
      userId,
      roleId: role.id,
      assignedBy: opts?.assignedBy ?? null,
    };
    const mgr = opts?.em ?? this.userRoles.manager;
    await mgr.save(UserRole, values);
    // подію емітуємо лише при реальній видачі — при no-op кеш чіпати не треба
    if (!opts?.em) this.events.emit(USER_ROLE_ADDED, { userId });
    return true;
  }
}
