import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VenuesService } from './venues.service';
import { VenueTaxonomyService } from './venues-taxonomy.service';
import { VenuesCatalogService } from './venues-catalog.service';
import { Venue, VenueStatus } from './entities/venue.entity';
import { VenuePhoto } from './entities/venue-photo.entity';
import { VenueFeature } from './entities/venue-feature.entity';
import { VenueFeatureAssignment } from './entities/venue-feature-assignment.entity';
import { Tag } from './entities/tag.entity';
import { VenueTag } from './entities/venue-tag.entity';
import { VenueType } from './entities/venue-type.entity';
import { VenueTypeAssignment } from './entities/venue-type-assignment.entity';
import { PermissionsService } from '../rbac/permissions.service';
import { makePermsMock } from '../../testing/permissions-mock';
import { FileStorageService } from '../../common/services/file-storage.service';

function qb() {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getOne: jest.fn(),
  };
}

/** Мок таксономії для спеків, де набірні поля в тестах не беруть участь. */
function taxonomyMock() {
  return {
    resolveFeatures: jest.fn().mockResolvedValue([]),
    resolveTags: jest.fn().mockResolvedValue([]),
    resolveType: jest.fn().mockResolvedValue(null),
    writeFeatures: jest.fn().mockResolvedValue(undefined),
    writeTags: jest.fn().mockResolvedValue(undefined),
    writeType: jest.fn().mockResolvedValue(undefined),
  };
}

describe('VenuesService', () => {
  let service: VenuesService;
  let venues: any;
  let em: any;
  let photos: any;
  let perms: any;
  let catalog: any;
  let events: any;
  let storage: any;
  let featuresRepo: any;
  let tagsRepo: any;
  let featureAssignmentsRepo: any;
  let venueTagsRepo: any;
  let venueTypesRepo: any;
  let venueTypeAssignmentsRepo: any;

  beforeEach(async () => {
    // Менеджер транзакції (create/update йдуть транзакцією): save/delete —
    // це дії «всерід» транзакції, тому теж перевіряються на em.
    em = {
      save: jest.fn(async (e: any) => e),
      delete: jest.fn(),
      update: jest.fn(),
    };
    venues = {
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb()),
      manager: { transaction: jest.fn(async (cb: any) => cb(em)) },
    };
    photos = { save: jest.fn(), insert: jest.fn(), count: jest.fn() };
    featuresRepo = { find: jest.fn().mockResolvedValue([]) };
    featureAssignmentsRepo = { save: jest.fn(), delete: jest.fn() };
    tagsRepo = { find: jest.fn().mockResolvedValue([]) };
    venueTagsRepo = { save: jest.fn(), delete: jest.fn() };
    venueTypesRepo = { findOne: jest.fn() };
    venueTypeAssignmentsRepo = { save: jest.fn(), delete: jest.fn() };
    perms = { ...makePermsMock(), invalidate: jest.fn() };
    catalog = { invalidateListCache: jest.fn().mockResolvedValue(undefined) };
    events = { emit: jest.fn() };
    storage = { save: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        VenuesService,
        VenueTaxonomyService,
        { provide: getRepositoryToken(Venue), useValue: venues },
        {
          provide: getRepositoryToken(VenuePhoto),
          useValue: photos,
        },
        {
          provide: getRepositoryToken(VenueFeature),
          useValue: featuresRepo,
        },
        {
          provide: getRepositoryToken(VenueFeatureAssignment),
          useValue: featureAssignmentsRepo,
        },
        { provide: getRepositoryToken(Tag), useValue: tagsRepo },
        {
          provide: getRepositoryToken(VenueTag),
          useValue: venueTagsRepo,
        },
        {
          provide: getRepositoryToken(VenueType),
          useValue: venueTypesRepo,
        },
        {
          provide: getRepositoryToken(VenueTypeAssignment),
          useValue: venueTypeAssignmentsRepo,
        },
        { provide: PermissionsService, useValue: perms },
        { provide: VenuesCatalogService, useValue: catalog },
        { provide: EventEmitter2, useValue: events },
        { provide: FileStorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VenuesService);
  });

  it('create пише фічі/теги/тип у em транзакції — не поза нею', async () => {
    // Окремий em транзакції (не той самий em beforeEach): якщо write-виклик
    // поїде поза manager.transaction, він отримає інший менеджер і впаде.
    const txEm = {
      save: jest.fn(async (e: any) => ({ ...e, id: 'v-new' })),
      delete: jest.fn(),
    };
    venues.manager.transaction.mockImplementation(async (cb: any) => cb(txEm));
    featuresRepo.find.mockResolvedValue([{ id: 'f1', code: 'wifi' }]);
    tagsRepo.find.mockResolvedValue([{ id: 't1', slug: 'beer' }]);
    venueTypesRepo.findOne.mockResolvedValue({ id: 'ty1', slug: 'bar' });
    const wf = jest
      .spyOn(VenueTaxonomyService.prototype, 'writeFeatures')
      .mockResolvedValue(undefined);
    const wt = jest
      .spyOn(VenueTaxonomyService.prototype, 'writeTags')
      .mockResolvedValue(undefined);
    const wty = jest
      .spyOn(VenueTaxonomyService.prototype, 'writeType')
      .mockResolvedValue(undefined);
    try {
      await service.create('u1', {
        name: 'X',
        address: 'Y',
        featureCodes: ['wifi'],
        tagSlugs: ['beer'],
        typeSlug: 'bar',
      });

      // id повернутий тим самим save транзакції → id приходить із ланцюга tx
      const venueId = 'v-new';
      expect(wf).toHaveBeenCalledWith(
        venueId,
        [{ id: 'f1', code: 'wifi' }],
        txEm,
      );
      expect(wt).toHaveBeenCalledWith(
        venueId,
        [{ id: 't1', slug: 'beer' }],
        txEm,
      );
      expect(wty).toHaveBeenCalledWith(
        venueId,
        { id: 'ty1', slug: 'bar' },
        txEm,
      );
      // Сам заклад теж записаний у той самий em транзакції, а не повз неї.
      expect(txEm.save).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'u1', name: 'X' }),
      );
      expect(em.save).not.toHaveBeenCalled();
      expect(wf).toHaveBeenCalledTimes(1);
      expect(wt).toHaveBeenCalledTimes(1);
      expect(wty).toHaveBeenCalledTimes(1);
    } finally {
      [wf, wt, wty].forEach((s) => s.mockRestore());
    }
  });

  it('create sets status=pending and emits event', async () => {
    const v = await service.create('u1', { name: 'X', address: 'Y' });
    expect((v as any).status).toBe(VenueStatus.Pending);
    expect(events.emit).toHaveBeenCalledWith(
      'venue.created',
      expect.anything(),
    );
  });

  it('update allows owner', async () => {
    venues.findOne.mockResolvedValueOnce({
      id: 'v1',
      ownerId: 'u1',
      status: VenueStatus.Approved,
    });
    await service.update('u1', 'v1', { name: 'New' });
    expect(events.emit).toHaveBeenCalledWith(
      'venue.updated',
      expect.anything(),
    );
  });

  it('update throws for non-owner without permission', async () => {
    venues.findOne.mockResolvedValueOnce({
      id: 'v1',
      ownerId: 'u2',
      status: VenueStatus.Approved,
    });
    perms.hasPermission.mockResolvedValueOnce(false);
    await expect(
      service.update('u1', 'v1', { name: 'X' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('update allows super_admin (venue:edit:any)', async () => {
    venues.findOne.mockResolvedValueOnce({
      id: 'v1',
      ownerId: 'u2',
      status: VenueStatus.Approved,
    });
    perms.hasPermission.mockResolvedValueOnce(true);
    await service.update('admin', 'v1', { name: 'X' });
    expect(em.save).toHaveBeenCalled();
  });

  describe('update — транзакція і подія', () => {
    const existing = () => ({
      id: 'v1',
      ownerId: 'u1',
      status: VenueStatus.Approved,
      name: 'Стара назва',
    });

    it('пише фічі/теги/тип і сам заклад в em транзакції — не поза нею', async () => {
      // Окремий txEm: якщо write-виклик поїде поза manager.transaction,
      // він отримає інший менеджер і тест впаде.
      const txEm = { save: jest.fn(async (e: any) => e), delete: jest.fn() };
      venues.manager.transaction.mockImplementation(async (cb: any) =>
        cb(txEm),
      );
      venues.findOne.mockResolvedValueOnce(existing());
      featuresRepo.find.mockResolvedValue([{ id: 'f1', code: 'wifi' }]);
      tagsRepo.find.mockResolvedValue([{ id: 't1', slug: 'beer' }]);
      venueTypesRepo.findOne.mockResolvedValue({ id: 'ty1', slug: 'bar' });
      const wf = jest
        .spyOn(VenueTaxonomyService.prototype, 'writeFeatures')
        .mockResolvedValue(undefined);
      const wt = jest
        .spyOn(VenueTaxonomyService.prototype, 'writeTags')
        .mockResolvedValue(undefined);
      const wty = jest
        .spyOn(VenueTaxonomyService.prototype, 'writeType')
        .mockResolvedValue(undefined);
      try {
        await service.update('u1', 'v1', {
          name: 'Нова',
          featureCodes: ['wifi'],
          tagSlugs: ['beer'],
          typeSlug: 'bar',
        });
        expect(wf).toHaveBeenCalledWith(
          'v1',
          [{ id: 'f1', code: 'wifi' }],
          txEm,
        );
        expect(wt).toHaveBeenCalledWith(
          'v1',
          [{ id: 't1', slug: 'beer' }],
          txEm,
        );
        expect(wty).toHaveBeenCalledWith(
          'v1',
          { id: 'ty1', slug: 'bar' },
          txEm,
        );
        expect(txEm.save).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'v1', name: 'Нова' }),
        );
        expect(em.save).not.toHaveBeenCalled();
      } finally {
        [wf, wt, wty].forEach((sp) => sp.mockRestore());
      }
    });

    it('запис заклад-після-прив’язок: порядок features → tags → type → save', async () => {
      const calls: string[] = [];
      const txEm = {
        save: jest.fn(async (e: any) => {
          calls.push('save');
          return e;
        }),
        delete: jest.fn(),
      };
      venues.manager.transaction.mockImplementation(async (cb: any) =>
        cb(txEm),
      );
      venues.findOne.mockResolvedValueOnce(existing());
      const spies = (['writeFeatures', 'writeTags', 'writeType'] as const).map(
        (m) =>
          jest
            .spyOn(VenueTaxonomyService.prototype, m)
            .mockImplementation(async () => {
              calls.push(m);
            }),
      );
      try {
        await service.update('u1', 'v1', {
          featureCodes: [],
          tagSlugs: [],
          typeSlug: null,
        } as any);
        expect(calls).toEqual([
          'writeFeatures',
          'writeTags',
          'writeType',
          'save',
        ]);
      } finally {
        spies.forEach((sp) => sp.mockRestore());
      }
    });

    it('подія venue.updated йде ПІСЛЯ коміту і несе venueId', async () => {
      const order: string[] = [];
      venues.manager.transaction.mockImplementation(async (cb: any) => {
        const r = await cb(em);
        order.push('commit');
        return r;
      });
      events.emit.mockImplementation(() => order.push('emit'));
      venues.findOne.mockResolvedValueOnce(existing());
      await service.update('u1', 'v1', { name: 'Нова' });
      expect(events.emit).toHaveBeenCalledWith('venue.updated', {
        venueId: 'v1',
      });
      expect(order).toEqual(['commit', 'emit']);
    });

    it('відмова в доступі: ні транзакції, ні події, ні запису', async () => {
      venues.findOne.mockResolvedValueOnce({ ...existing(), ownerId: 'u2' });
      perms.hasPermission.mockResolvedValueOnce(false);
      await expect(service.update('u1', 'v1', { name: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(venues.manager.transaction).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('невідомий код фічі → 400 до транзакції і без події', async () => {
      venues.findOne.mockResolvedValueOnce(existing());
      await expect(
        service.update('u1', 'v1', { featureCodes: ['bogus'] }),
      ).rejects.toThrow(BadRequestException);
      expect(venues.manager.transaction).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('падіння всередині транзакції: подія не публікується', async () => {
      venues.manager.transaction.mockRejectedValueOnce(new Error('db down'));
      venues.findOne.mockResolvedValueOnce(existing());
      await expect(
        service.update('u1', 'v1', { name: 'Нова' }),
      ).rejects.toThrow('db down');
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('неіснуючий заклад → 404, без перевірки прав і запису', async () => {
      venues.findOne.mockResolvedValueOnce(null);
      await expect(service.update('u1', 'nope', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(venues.manager.transaction).not.toHaveBeenCalled();
    });
  });

  describe('update/create — очист й заміна опційних полів', () => {
    const venueDraft = (): any => ({
      id: 'v1',
      ownerId: 'u1',
      status: VenueStatus.Approved,
      name: 'Стара назва',
      description: 'Старий опис',
      latitude: 50.45,
      longitude: 30.52,
      contacts: { phone: '+380671234567' },
      workingHours: { monday: '10:00-22:00' },
      averageCheck: 250,
    });

    function draft() {
      em.save.mockClear();
      em.delete.mockClear();
      const venue = venueDraft();
      venues.findOne.mockResolvedValueOnce(venue);
      perms.hasPermission.mockResolvedValueOnce(true);
      return venue;
    }

    it('очищення: явний null і порожній рядок пишуть null, відсутній ключ не чіпає', async () => {
      const venue = draft();
      await service.update('u1', 'v1', { description: null } as any);
      expect(venue.description).toBeNull();
      expect(venue.latitude).toBe(50.45);
      expect(venue.averageCheck).toBe(250);

      const venue2 = draft();
      await service.update('u1', 'v1', {
        description: '   ',
        latitude: null,
        averageCheck: null,
      } as any);
      expect(venue2.description).toBeNull();
      expect(venue2.latitude).toBeNull();
      expect(venue2.averageCheck).toBeNull();
    });

    it('contacts/workingHours: ключ присутній → заміна обʼєкта, порожні ключі видаляються', async () => {
      const venue = draft();
      await service.update('u1', 'v1', {
        contacts: { phone: null, instagram: ' http://ig ' },
      } as any);
      expect(venue.contacts).toEqual({ instagram: 'http://ig' });

      const venue2 = draft();
      await service.update('u1', 'v1', {
        workingHours: { monday: '09:00-18:00', tuesday: '' },
      } as any);
      expect(venue2.workingHours).toEqual({ monday: '09:00-18:00' });
    });

    it('name/address: null чи відсутнє значення не очищає, нове — перезаписує', async () => {
      const venue = draft();
      await service.update('u1', 'v1', {
        name: null,
        address: undefined,
      } as any);
      expect(venue.name).toBe('Стара назва');
      expect(venue.address).toBe(venueDraft().address);

      const venue2 = draft();
      await service.update('u1', 'v1', { name: 'Нова', address: 'вул. Нова' });
      expect(venue2.name).toBe('Нова');
      expect(venue2.address).toBe('вул. Нова');
    });

    it('latitude/longitude/averageCheck/description: нове значення записується', async () => {
      const venue = draft();
      await service.update('u1', 'v1', {
        latitude: 49.84,
        longitude: 24.03,
        averageCheck: 400,
        description: '  Новий опис  ',
      } as any);
      expect(venue.latitude).toBe(49.84);
      expect(venue.longitude).toBe(24.03);
      expect(venue.averageCheck).toBe(400);
      expect(venue.description).toBe('Новий опис');
    });

    it('без ключів таксономій прив’язки не чіпаються (ні delete, ні save, ні resolve)', async () => {
      draft();
      await service.update('u1', 'v1', { name: 'Інша' });
      expect(em.delete).not.toHaveBeenCalled();
      expect(featuresRepo.find).not.toHaveBeenCalled();
      expect(tagsRepo.find).not.toHaveBeenCalled();
      expect(venueTypesRepo.findOne).not.toHaveBeenCalled();
      // сам заклад збережений тією ж транзакцією
      expect(em.save).toHaveBeenCalledTimes(1);
    });

    it('featureCodes: заміна набору — delete старих привʼязок + save нових', async () => {
      const venue = draft();
      featuresRepo.find.mockResolvedValue([
        { id: 'f1', code: 'wifi' },
        { id: 'f2', code: 'terrace' },
      ]);
      await service.update('u1', 'v1', {
        featureCodes: ['wifi', 'terrace'],
      } as any);
      expect(em.delete).toHaveBeenCalledWith(VenueFeatureAssignment, {
        venueId: 'v1',
      });
      expect(em.save).toHaveBeenCalledWith(VenueFeatureAssignment, [
        { venueId: 'v1', featureId: 'f1' },
        { venueId: 'v1', featureId: 'f2' },
      ]);
      expect(venue.name).toBe('Стара назва');
    });

    it('featureCodes: порожній масив знімає всі привʼязки, невідомий код — 400', async () => {
      draft();
      await service.update('u1', 'v1', { featureCodes: [] } as any);
      expect(em.delete).toHaveBeenCalledWith(VenueFeatureAssignment, {
        venueId: 'v1',
      });
      expect(em.save).not.toHaveBeenCalledWith(
        VenueFeatureAssignment,
        expect.anything(),
      );

      draft();
      em.delete.mockClear();
      await expect(
        service.update('u1', 'v1', { featureCodes: ['bogus'] } as any),
      ).rejects.toThrow(BadRequestException);
      expect(em.delete).not.toHaveBeenCalled();
    });

    it('tagSlugs: заміна набору, невідомий слаг — 400', async () => {
      draft();
      tagsRepo.find.mockResolvedValue([{ id: 't1', slug: 'kraft' }]);
      await service.update('u1', 'v1', { tagSlugs: ['kraft'] } as any);
      expect(em.delete).toHaveBeenCalledWith(VenueTag, { venueId: 'v1' });
      expect(em.save).toHaveBeenCalledWith(VenueTag, [
        { venueId: 'v1', tagId: 't1' },
      ]);

      draft();
      tagsRepo.find.mockResolvedValue([{ id: 't1', slug: 'kraft' }]);
      await expect(
        service.update('u1', 'v1', { tagSlugs: ['bogus'] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('typeSlug: заміна типу, порожній рядок/null знімає тип, невідомий — 400', async () => {
      draft();
      venueTypesRepo.findOne.mockResolvedValue({ id: 'ty1', slug: 'bar' });
      await service.update('u1', 'v1', { typeSlug: 'bar' } as any);
      expect(em.delete).toHaveBeenCalledWith(VenueTypeAssignment, {
        venueId: 'v1',
      });
      expect(em.save).toHaveBeenCalledWith(VenueTypeAssignment, {
        venueId: 'v1',
        typeId: 'ty1',
      });

      draft();
      await service.update('u1', 'v1', { typeSlug: null } as any);
      expect(em.delete).toHaveBeenCalledWith(VenueTypeAssignment, {
        venueId: 'v1',
      });
      // лише з першого кроку: null-тип — delete без save прив'язки
      expect(em.save).not.toHaveBeenCalledWith(
        VenueTypeAssignment,
        expect.anything(),
      );

      draft();
      venueTypesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('u1', 'v1', { typeSlug: 'bogus' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('create з невідомим typeSlug/tagSlug/featureCode — 400 (валідація до транзакції — запису нема взагалі)', async () => {
      venueTypesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create('u1', { name: 'X', address: 'Y', typeSlug: 'bogus' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create('u1', {
          name: 'X',
          address: 'Y',
          tagSlugs: ['bogus'],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create('u1', {
          name: 'X',
          address: 'Y',
          featureCodes: ['nope'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(em.save).not.toHaveBeenCalled();
    });
  });

  it('softDelete архівує заклад власника, подія несе реальний попередній статус', async () => {
    const venue = {
      id: 'v1',
      ownerId: 'u1',
      status: VenueStatus.Approved,
    };
    venues.findOne.mockResolvedValueOnce(venue);
    await service.softDelete('u1', 'v1');
    expect(venue.status).toBe(VenueStatus.Archived);
    expect(venues.save).toHaveBeenCalledWith(venue);
    expect(events.emit).toHaveBeenCalledWith(
      'venue.status_changed',
      expect.objectContaining({
        venueId: 'v1',
        from: VenueStatus.Approved,
        to: VenueStatus.Archived,
      }),
    );
  });

  it('softDelete pending-заявки: подія з from: pending, а не approved', async () => {
    const venue = {
      id: 'v2',
      ownerId: 'u1',
      status: VenueStatus.Pending,
    };
    venues.findOne.mockResolvedValueOnce(venue);
    await service.softDelete('u1', 'v2');
    expect(events.emit).toHaveBeenCalledWith(
      'venue.status_changed',
      expect.objectContaining({
        from: VenueStatus.Pending,
        to: VenueStatus.Archived,
      }),
    );
  });

  it('повторне softDelete видаленого закладу — 409, без події', async () => {
    venues.findOne.mockResolvedValueOnce({
      id: 'v1',
      ownerId: 'u1',
      status: VenueStatus.Archived,
    });
    await expect(service.softDelete('u1', 'v1')).rejects.toThrow(
      ConflictException,
    );
    expect(venues.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('softDelete дозволений супер-адміну (venue:edit:any)', async () => {
    venues.findOne.mockResolvedValueOnce({
      id: 'v1',
      ownerId: 'u2',
      status: VenueStatus.Approved,
    });
    perms.hasPermission.mockResolvedValueOnce(true);
    await service.softDelete('admin', 'v1');
    expect(venues.save).toHaveBeenCalled();
  });

  it('softDelete кидає 403 для не-власника без права', async () => {
    venues.findOne.mockResolvedValueOnce({
      id: 'v1',
      ownerId: 'u2',
      status: VenueStatus.Approved,
    });
    perms.hasPermission.mockResolvedValueOnce(false);
    await expect(service.softDelete('u1', 'v1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('findOneOrThrow throws on missing', async () => {
    venues.findOne.mockResolvedValueOnce(null);
    await expect(service.findOneOrThrow('x')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('getForOwnerOrAdmin', () => {
    function chainWithVenue(venue: any) {
      const chain = qb();
      chain.getOne.mockResolvedValue(venue);
      venues.createQueryBuilder.mockReturnValue(chain);
      return chain;
    }

    it('власник бачить свій заклад у будь-якому статусі', async () => {
      chainWithVenue({ id: 'v1', ownerId: 'u1', status: 'pending' });
      const res = await service.getForOwnerOrAdmin('u1', 'v1');
      expect(res.status).toBe('pending');
      expect(perms.hasPermission).not.toHaveBeenCalled();
    });

    it('не-власник з venue:edit:any теж отримує заклад', async () => {
      chainWithVenue({ id: 'v2', ownerId: 'other', status: 'rejected' });
      perms.hasPermission.mockResolvedValueOnce(true);
      const res = await service.getForOwnerOrAdmin('u1', 'v2');
      expect(res.id).toBe('v2');
    });

    it('не-власник без права → Forbidden', async () => {
      chainWithVenue({ id: 'v2', ownerId: 'other', status: 'approved' });
      perms.hasPermission.mockResolvedValueOnce(false);
      await expect(service.getForOwnerOrAdmin('u1', 'v2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('неіснуючий заклад → NotFound', async () => {
      chainWithVenue(null);
      await expect(service.getForOwnerOrAdmin('u1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('uploadPhoto', () => {
    const file = {
      originalname: 'a.png',
      mimetype: 'image/png',
      size: 10,
      buffer: Buffer.from('x'),
    };

    it('зберігає файл, створює VenuePhoto і ставить mainPhotoUrl, якщо його не було', async () => {
      venues.findOne.mockResolvedValueOnce({
        id: 'v1',
        ownerId: 'u1',
        mainPhotoUrl: null,
      });
      photos.count.mockResolvedValueOnce(2);
      storage.save.mockResolvedValueOnce({
        url: '/static/venues/v1/abc.png',
        filename: 'abc.png',
        size: 10,
      });
      const out = await service.uploadPhoto('u1', 'v1', file);
      expect(storage.save).toHaveBeenCalledWith('venues/v1', file);
      expect(photos.insert).toHaveBeenCalledWith({
        venueId: 'v1',
        url: '/static/venues/v1/abc.png',
        sortOrder: 2,
      });
      expect(venues.save).toHaveBeenCalledWith(
        expect.objectContaining({
          mainPhotoUrl: '/static/venues/v1/abc.png',
        }),
      );
      expect(out.url).toBe('/static/venues/v1/abc.png');
    });

    it('не перезаписує наявний mainPhotoUrl', async () => {
      venues.findOne.mockResolvedValueOnce({
        id: 'v1',
        ownerId: 'u1',
        mainPhotoUrl: '/static/venues/v1/old.png',
      });
      storage.save.mockResolvedValueOnce({
        url: '/static/venues/v1/new.png',
        filename: 'new.png',
        size: 10,
      });
      await service.uploadPhoto('u1', 'v1', file);
      expect(venues.save).not.toHaveBeenCalled();
      expect(photos.insert).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/static/venues/v1/new.png' }),
      );
    });

    it('кидає Forbidden для чужого закладу без права venue:edit:any', async () => {
      venues.findOne.mockResolvedValueOnce({
        id: 'v1',
        ownerId: 'u2',
        mainPhotoUrl: null,
      });
      perms.hasPermission.mockResolvedValueOnce(false);
      await expect(service.uploadPhoto('u1', 'v1', file)).rejects.toThrow(
        ForbiddenException,
      );
      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe('recommendations (критик)', () => {
    const approved = {
      id: 'v1',
      status: VenueStatus.Approved,
      recommendedBy: null,
      recommendedAt: null,
    };

    beforeEach(() => {
      venues.save.mockImplementation(async (v: any) => v);
      catalog.invalidateListCache.mockResolvedValue(undefined);
    });

    it('recommend ставить recommendedBy/recommendedAt і скидає кеш списку', async () => {
      venues.findOne.mockResolvedValueOnce({ ...approved });
      perms.hasPermission.mockResolvedValueOnce(true);
      const saved = await service.recommend('u-critic', 'v1');
      expect(saved.recommendedBy).toBe('u-critic');
      expect(saved.recommendedAt).toBeInstanceOf(Date);
      expect(catalog.invalidateListCache).toHaveBeenCalled();
    });

    it('recommend кидає 403 без дозволу venue:recommend', async () => {
      venues.findOne.mockResolvedValueOnce({ ...approved });
      perms.hasPermission.mockResolvedValueOnce(false);
      await expect(service.recommend('u1', 'v1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(venues.save).not.toHaveBeenCalled();
    });

    it('recommend кидає 404 для не-схваленого закладу (маска «не знайдено»)', async () => {
      venues.findOne.mockResolvedValueOnce({
        ...approved,
        status: VenueStatus.Pending,
      });
      perms.hasPermission.mockResolvedValueOnce(true);
      await expect(service.recommend('u-critic', 'v1')).rejects.toThrow(
        NotFoundException,
      );
      expect(venues.save).not.toHaveBeenCalled();
    });

    it('recommend перезаписує попередню (чужу) рекомендацію — 1 критик на заклад', async () => {
      venues.findOne.mockResolvedValueOnce({
        ...approved,
        recommendedBy: 'u-old-critic',
        recommendedAt: new Date('2026-01-01'),
      });
      perms.hasPermission.mockResolvedValueOnce(true);
      const saved = await service.recommend('u-critic', 'v1');
      expect(saved.recommendedBy).toBe('u-critic');
    });

    it('unrecommend знімає свою рекомендацію', async () => {
      venues.findOne.mockResolvedValueOnce({
        ...approved,
        recommendedBy: 'u-critic',
        recommendedAt: new Date('2026-01-01'),
      });
      perms.hasPermission.mockResolvedValueOnce(true);
      const saved = await service.unrecommend('u-critic', 'v1');
      expect(saved.recommendedBy).toBeNull();
      expect(saved.recommendedAt).toBeNull();
      expect(catalog.invalidateListCache).toHaveBeenCalled();
    });

    it('unrecommend кидає 403 за чужу рекомендацію', async () => {
      venues.findOne.mockResolvedValueOnce({
        ...approved,
        recommendedBy: 'u-another-critic',
      });
      perms.hasPermission.mockResolvedValueOnce(true);
      await expect(service.unrecommend('u-critic', 'v1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(venues.save).not.toHaveBeenCalled();
    });

    it('unrecommend кидає 403 без дозволу venue:recommend', async () => {
      venues.findOne.mockResolvedValueOnce({ ...approved });
      perms.hasPermission.mockResolvedValueOnce(false);
      await expect(service.unrecommend('u1', 'v1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('listRecommendedByUser повертає заклади своєї рекомендації', async () => {
      const listQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]),
      };
      venues.createQueryBuilder.mockReturnValueOnce(listQb);
      const rows = await service.listRecommendedByUser('u-critic');
      expect(rows.map((r: any) => r.id)).toEqual(['v1', 'v2']);
      expect(listQb.where).toHaveBeenCalledWith('v.recommendedBy = :userId', {
        userId: 'u-critic',
      });
    });
  });
});

describe('VenuesService.findOnePublic — санітизація власника', () => {
  let service: VenuesService;
  let venues: any;
  let perms: any;
  let catalog: any;
  let events: any;
  let storage: any;
  let photos: any;

  beforeEach(async () => {
    photos = {};
    perms = makePermsMock();
    perms.hasPermission.mockResolvedValue(true);
    catalog = { invalidateListCache: jest.fn().mockResolvedValue(undefined) };
    events = { emit: jest.fn() };
    storage = { save: jest.fn(), remove: jest.fn() };
    venues = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn().mockReturnValue(qb()),
    };
    const module = await Test.createTestingModule({
      providers: [
        VenuesService,
        { provide: getRepositoryToken(Venue), useValue: venues },
        { provide: getRepositoryToken(VenuePhoto), useValue: photos },
        { provide: getRepositoryToken(VenueFeature), useValue: {} },
        {
          provide: getRepositoryToken(VenueFeatureAssignment),
          useValue: { save: jest.fn(), delete: jest.fn() },
        },
        { provide: getRepositoryToken(Tag), useValue: { find: jest.fn() } },
        {
          provide: getRepositoryToken(VenueTag),
          useValue: { save: jest.fn(), delete: jest.fn() },
        },
        { provide: getRepositoryToken(VenueType), useValue: {} },
        {
          provide: getRepositoryToken(VenueTypeAssignment),
          useValue: { save: jest.fn(), delete: jest.fn() },
        },
        { provide: VenueTaxonomyService, useValue: taxonomyMock() },
        { provide: PermissionsService, useValue: perms },
        { provide: VenuesCatalogService, useValue: catalog },
        { provide: FileStorageService, useValue: storage },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(VenuesService);
  });

  it('owner без email/passwordHash/emailVerified/deletedAt і БЕЗ телефона', async () => {
    const venue = {
      id: 'v1',
      status: 'approved',
      owner: {
        id: 'u1',
        email: 'owner@example.com',
        passwordHash: '$2b$10$secretsecretsecret',
        emailVerified: true,
        deletedAt: null,
        profile: {
          firstname: 'Олена',
          lastname: 'Ковальчук',
          avatarUrl: null,
          age: 30,
          phone: '+380991234567',
        },
      },
    };
    venues.createQueryBuilder.mockReturnValueOnce({
      ...qb(),
      getOne: jest.fn().mockResolvedValue(venue),
    });
    const res = await service.findOnePublic('v1');
    expect(res.id).toBe('v1');
    expect(res.owner).not.toHaveProperty('email');
    expect(res.owner).not.toHaveProperty('passwordHash');
    expect(res.owner).not.toHaveProperty('emailVerified');
    expect(res.owner).not.toHaveProperty('deletedAt');
    expect(res.owner.profile.firstname).toBe('Олена');
    expect(res.owner.profile.phone).toBeUndefined();
  });
});

describe('VenuesService — модерація закладів', () => {
  let service: VenuesService;
  let venues: any;
  let em: any;
  let catalog: any;
  let perms: any;
  let events: any;
  let storage: any;
  beforeEach(async () => {
    perms = makePermsMock();
    perms.hasPermission.mockResolvedValue(false);
    catalog = { invalidateListCache: jest.fn().mockResolvedValue(undefined) };
    events = { emit: jest.fn() };
    storage = { save: jest.fn(), remove: jest.fn() };
    em = { save: jest.fn(async (e: any) => e), delete: jest.fn() };
    venues = {
      findOne: jest.fn(),
      save: jest.fn((v) => v),
      create: jest.fn((x) => x),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn().mockReturnValue(qb()),
      manager: { transaction: jest.fn(async (cb: any) => cb(em)) },
    };
    const module = await Test.createTestingModule({
      providers: [
        VenuesService,
        { provide: getRepositoryToken(Venue), useValue: venues },
        { provide: getRepositoryToken(VenuePhoto), useValue: {} },
        { provide: getRepositoryToken(VenueFeature), useValue: {} },
        {
          provide: getRepositoryToken(VenueFeatureAssignment),
          useValue: { save: jest.fn(), delete: jest.fn() },
        },
        { provide: getRepositoryToken(Tag), useValue: { find: jest.fn() } },
        {
          provide: getRepositoryToken(VenueTag),
          useValue: { save: jest.fn(), delete: jest.fn() },
        },
        { provide: getRepositoryToken(VenueType), useValue: {} },
        {
          provide: getRepositoryToken(VenueTypeAssignment),
          useValue: { save: jest.fn(), delete: jest.fn() },
        },
        { provide: VenueTaxonomyService, useValue: taxonomyMock() },
        { provide: PermissionsService, useValue: perms },
        { provide: VenuesCatalogService, useValue: catalog },
        { provide: FileStorageService, useValue: storage },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(VenuesService);
  });

  it('супер-адмін (venue:moderate) створює заклад одразу approved', async () => {
    perms.hasPermission.mockResolvedValueOnce(true);
    const v = await service.create('admin1', { name: 'Кеш', address: 'а' });
    expect(v.status).toBe('approved');
  });

  it('звичайний юзер створює заклад у pending', async () => {
    perms.hasPermission.mockResolvedValue(false);
    const v = await service.create('u1', { name: 'Звичайний', address: 'а' });
    expect(v.status).toBe('pending');
  });
});
