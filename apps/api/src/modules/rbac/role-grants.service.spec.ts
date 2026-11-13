import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityManager } from 'typeorm';
import { RoleGrantsService } from './role-grants.service';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { USER_ROLE_ADDED } from './listeners/user-role.listener';

describe('RoleGrantsService', () => {
  let service: RoleGrantsService;
  let roles: any;
  let userRoles: any;
  let events: any;

  beforeEach(async () => {
    roles = { findOne: jest.fn() };
    userRoles = {
      findOne: jest.fn(),
      save: jest.fn(),
      manager: { save: jest.fn() },
    };
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        RoleGrantsService,
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(UserRole), useValue: userRoles },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(RoleGrantsService);
  });

  it('видає роль: save + подія user_role.added (кеш пермішенів скидає слухач)', async () => {
    roles.findOne.mockResolvedValueOnce({ id: 'r1', code: 'venue_admin' });
    userRoles.findOne.mockResolvedValueOnce(null); // ролі ще нема
    const granted = await service.grant('u1', 'venue_admin');
    expect(granted).toBe(true);
    expect(userRoles.manager.save).toHaveBeenCalledWith(UserRole, {
      userId: 'u1',
      roleId: 'r1',
      assignedBy: null,
    });
    expect(events.emit).toHaveBeenCalledWith(USER_ROLE_ADDED, { userId: 'u1' });
  });

  it('видана адміном роль зберігає assignedBy', async () => {
    roles.findOne.mockResolvedValueOnce({ id: 'r1', code: 'admin' });
    userRoles.findOne.mockResolvedValueOnce(null);
    await service.grant('u2', 'admin', { assignedBy: 'a1' });
    expect(userRoles.manager.save).toHaveBeenCalledWith(UserRole, {
      userId: 'u2',
      roleId: 'r1',
      assignedBy: 'a1',
    });
  });

  it('grant з чужим em: запис через em, подію НЕ емітуємо (її емітує викликач після коміту)', async () => {
    roles.findOne.mockResolvedValueOnce({ id: 'r1', code: 'venue_admin' });
    userRoles.findOne.mockResolvedValueOnce(null);
    const em = { save: jest.fn() };
    const granted = await service.grant('u1', 'venue_admin', {
      em: em as unknown as EntityManager,
    });
    expect(granted).toBe(true);
    expect(em.save).toHaveBeenCalledWith(UserRole, {
      userId: 'u1',
      roleId: 'r1',
      assignedBy: null,
    });
    expect(userRoles.manager.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('ідемпотентність: роль уже видана — жодних записів і подій', async () => {
    roles.findOne.mockResolvedValueOnce({ id: 'r1', code: 'venue_admin' });
    userRoles.findOne.mockResolvedValueOnce({
      userId: 'u1',
      roleId: 'r1',
    });
    const granted = await service.grant('u1', 'venue_admin');
    expect(granted).toBe(false);
    expect(userRoles.manager.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('ролі з таким кодом немає в системі — false без запису', async () => {
    roles.findOne.mockResolvedValueOnce(null);
    const granted = await service.grant('u1', 'venue_admin');
    expect(granted).toBe(false);
    expect(userRoles.findOne).not.toHaveBeenCalled();
    expect(userRoles.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
