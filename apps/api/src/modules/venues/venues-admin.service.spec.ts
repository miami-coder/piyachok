import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException } from '@nestjs/common';
import { VenuesAdminService } from './venues-admin.service';
import { VenuesService } from './venues.service';
import { Venue, VenueStatus } from './entities/venue.entity';
import { RoleGrantsService } from '../rbac/role-grants.service';
import { AuditService } from '../admin/audit.service';

describe('VenuesAdminService', () => {
  let service: VenuesAdminService;
  let venues: any;
  let core: any;
  let roleGrants: any;
  let audit: any;
  let events: any;

  beforeEach(async () => {
    venues = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      save: jest.fn((v: any) => v),
      // Транзакція апруву/assignOwner: em «всерід» — це сам мок репозиторію
      manager: {
        transaction: jest.fn(async (cb: any) => cb(venues)),
      },
    };
    core = { findOneOrThrow: jest.fn() };
    roleGrants = { grant: jest.fn().mockResolvedValue(false) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    events = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        VenuesAdminService,
        { provide: getRepositoryToken(Venue), useValue: venues },
        { provide: VenuesService, useValue: core },
        { provide: RoleGrantsService, useValue: roleGrants },
        { provide: AuditService, useValue: audit },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(VenuesAdminService);
  });

  describe('зміна статусу', () => {
    it('changeStatus пише статус і емітує подію venue.status_changed', async () => {
      core.findOneOrThrow.mockResolvedValueOnce({
        id: 'v1',
        status: VenueStatus.Pending,
      });
      const v = await service.changeStatus('v1', VenueStatus.Approved);
      expect(v.status).toBe(VenueStatus.Approved);
      expect(events.emit).toHaveBeenCalledWith(
        'venue.status_changed',
        expect.anything(),
      );
    });

    it('апрув видаленого (archived) закладу заборонений', async () => {
      core.findOneOrThrow.mockResolvedValueOnce({
        id: 'v1',
        status: 'archived',
        ownerId: 'u9',
      });
      await expect(service.approve('admin1', 'v1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(venues.save).not.toHaveBeenCalled();
    });

    it('approve змінює статус і видає власнику роль venue_admin', async () => {
      // approve: перший фетч (перевірка archived), другий у changeStatus
      core.findOneOrThrow
        .mockResolvedValueOnce({
          id: 'v1',
          ownerId: 'u1',
          status: VenueStatus.Pending,
        })
        .mockResolvedValueOnce({
          id: 'v1',
          ownerId: 'u1',
          status: VenueStatus.Pending,
        });
      roleGrants.grant.mockResolvedValueOnce(true);
      const v = await service.approve('admin1', 'v1');
      expect(v.status).toBe(VenueStatus.Approved);
      expect(roleGrants.grant).toHaveBeenCalledWith(
        'u1',
        'venue_admin',
        expect.anything(), // em — транзакція approve/assignOwner
      );
      // події — після коміту транзакції
      expect(events.emit).toHaveBeenCalledWith(
        'venue.status_changed',
        expect.anything(),
      );
      expect(events.emit).toHaveBeenCalledWith('user_role.added', {
        userId: 'u1',
      });
      expect(events.emit).toHaveBeenCalledTimes(2);
      expect(audit.log).toHaveBeenCalledWith(
        'admin1',
        'venue_approve',
        'venue',
        'v1',
        null,
        expect.objectContaining({ roleGranted: true }),
        expect.anything(), // em — транзакція
      );
    });

    it('approve не дублює роль, якщо власник уже має venue_admin', async () => {
      core.findOneOrThrow
        .mockResolvedValueOnce({
          id: 'v1',
          ownerId: 'u1',
          status: VenueStatus.Pending,
        })
        .mockResolvedValueOnce({
          id: 'v1',
          ownerId: 'u1',
          status: VenueStatus.Pending,
        });
      roleGrants.grant.mockResolvedValueOnce(false); // вже видана
      await service.approve('admin1', 'v1');
      expect(roleGrants.grant).toHaveBeenCalledTimes(1);
    });
  });

  describe('assignOwner', () => {
    it('схваленому закладу — новому власнику ідемпотентно видається venue_admin + аудит з before/after', async () => {
      core.findOneOrThrow.mockResolvedValueOnce({
        id: 'v1',
        ownerId: 'old',
        status: VenueStatus.Approved,
      });
      roleGrants.grant.mockResolvedValueOnce(true);
      const v = await service.assignOwner('admin1', 'v1', 'u1');
      expect(v.ownerId).toBe('u1');
      expect(roleGrants.grant).toHaveBeenCalledWith(
        'u1',
        'venue_admin',
        expect.anything(), // em — транзакція approve/assignOwner
      );
      expect(audit.log).toHaveBeenCalledWith(
        'admin1',
        'venue_assign_owner',
        'venue',
        'v1',
        { ownerId: 'old' },
        { ownerId: 'u1', roleGranted: true },
        expect.anything(), // em — транзакція
      );
    });

    it('pending-заклад — роль не видається (її видасть approve), у аудиті roleGranted: false', async () => {
      core.findOneOrThrow.mockResolvedValueOnce({
        id: 'v1',
        ownerId: null,
        status: VenueStatus.Pending,
      });
      await service.assignOwner('admin1', 'v1', 'u1');
      expect(roleGrants.grant).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        'admin1',
        'venue_assign_owner',
        'venue',
        'v1',
        null,
        { ownerId: 'u1', roleGranted: false },
        expect.anything(), // em — транзакція
      );
    });

    it('власник уже має роль — дублю не пишеться, roleGranted: false', async () => {
      core.findOneOrThrow.mockResolvedValueOnce({
        id: 'v1',
        ownerId: 'old',
        status: VenueStatus.Approved,
      });
      roleGrants.grant.mockResolvedValueOnce(false);
      await service.assignOwner('admin1', 'v1', 'u1');
      expect(roleGrants.grant).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        'admin1',
        'venue_assign_owner',
        'venue',
        'v1',
        { ownerId: 'old' },
        { ownerId: 'u1', roleGranted: false },
        expect.anything(), // em — транзакція
      );
    });
  });

  describe('списки модерації', () => {
    it('findApproved — owner без passwordHash/email/phone (санітизація перед видачею адміну)', async () => {
      venues.findAndCount.mockResolvedValueOnce([
        [
          {
            id: 'v1',
            owner: {
              id: 'u1',
              email: 'o@x.com',
              passwordHash: '$2b$10$secret',
              profile: { firstname: 'Олег', phone: '+380991234567' },
            },
          },
        ],
        1,
      ]);
      const res = await service.findApproved(1, 20);
      const own = res.data[0].owner;
      expect(own).not.toHaveProperty('passwordHash');
      expect(own).not.toHaveProperty('email');
      expect((own.profile as { phone?: unknown }).phone).toBeUndefined();
      expect(own.profile?.firstname).toBe('Олег');
    });

    it('findPending читає заявки (адмін бачить повний склад заявки)', async () => {
      await service.findPending(1, 20);
      expect(venues.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: VenueStatus.Pending } }),
      );
    });
  });
});
