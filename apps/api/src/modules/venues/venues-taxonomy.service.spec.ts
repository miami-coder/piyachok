import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { VenueTaxonomyService } from './venues-taxonomy.service';
import { VenueFeature } from './entities/venue-feature.entity';
import { VenueFeatureAssignment } from './entities/venue-feature-assignment.entity';
import { Tag } from './entities/tag.entity';
import { VenueTag } from './entities/venue-tag.entity';
import { VenueType } from './entities/venue-type.entity';
import { VenueTypeAssignment } from './entities/venue-type-assignment.entity';

describe('VenueTaxonomyService', () => {
  let service: VenueTaxonomyService;
  let featuresRepo: any;
  let featureAssignmentsRepo: any;
  let tagsRepo: any;
  let venueTagsRepo: any;
  let venueTypesRepo: any;
  let venueTypeAssignmentsRepo: any;

  beforeEach(async () => {
    featuresRepo = { find: jest.fn().mockResolvedValue([]) };
    featureAssignmentsRepo = { save: jest.fn(), delete: jest.fn() };
    tagsRepo = { find: jest.fn().mockResolvedValue([]) };
    venueTagsRepo = { save: jest.fn(), delete: jest.fn() };
    venueTypesRepo = { findOne: jest.fn() };
    venueTypeAssignmentsRepo = { save: jest.fn(), delete: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        VenueTaxonomyService,
        { provide: getRepositoryToken(VenueFeature), useValue: featuresRepo },
        {
          provide: getRepositoryToken(VenueFeatureAssignment),
          useValue: featureAssignmentsRepo,
        },
        { provide: getRepositoryToken(Tag), useValue: tagsRepo },
        { provide: getRepositoryToken(VenueTag), useValue: venueTagsRepo },
        { provide: getRepositoryToken(VenueType), useValue: venueTypesRepo },
        {
          provide: getRepositoryToken(VenueTypeAssignment),
          useValue: venueTypeAssignmentsRepo,
        },
      ],
    }).compile();
    service = module.get(VenueTaxonomyService);
  });

  describe('довідники', () => {
    it('listTypes/listFeatures читають довідники відсортованими за назвою', async () => {
      featuresRepo.find.mockResolvedValueOnce([{ id: 'f1', name: 'Wi-Fi' }]);
      venueTypesRepo.find = jest
        .fn()
        .mockResolvedValue([{ id: 't1', name: 'Бар' }]);
      await service.listFeatures();
      expect(featuresRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
      await service.listTypes();
      expect(venueTypesRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
    });

    it('listTags повертає тег + кількість закладів', async () => {
      const tagQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([
            { id: 't1', name: 'Крафт', slug: 'kraft', venueCount: 5 },
          ]),
      };
      tagsRepo.createQueryBuilder = jest.fn().mockReturnValue(tagQb);
      const rows = await service.listTags();
      expect(rows).toEqual([
        { id: 't1', name: 'Крафт', slug: 'kraft', venueCount: 5 },
      ]);
      expect(tagsRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('resolveFeatures (невідомий код — 400 до запису)', () => {
    it('повертає знайдені фічі за унікальними кодами', async () => {
      featuresRepo.find.mockResolvedValue([{ id: 'f1', code: 'wifi' }]);
      const rows = await service.resolveFeatures(['wifi', 'wifi']);
      expect(rows).toEqual([{ id: 'f1', code: 'wifi' }]);
      // In(...) — FindOperator; перевіряємо набір унікалізованих кодів
      const where = featuresRepo.find.mock.calls[0][0].where;
      expect((where.code as { value: string[] }).value).toEqual(['wifi']);
    });

    it('порожній список — без запиту в БД, порожній результат', async () => {
      const rows = await service.resolveFeatures([]);
      expect(rows).toEqual([]);
      expect(featuresRepo.find).not.toHaveBeenCalled();
    });

    it('невідомий код — BadRequestException з переліком', async () => {
      featuresRepo.find.mockResolvedValue([{ id: 'f1', code: 'wifi' }]);
      await expect(service.resolveFeatures(['bogus'])).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resolveTags', () => {
    it('невідомий слаг — BadRequestException', async () => {
      tagsRepo.find.mockResolvedValue([{ id: 't1', slug: 'kraft' }]);
      await expect(service.resolveTags(['bogus'])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('порожній список — без запиту в БД', async () => {
      expect(await service.resolveTags([])).toEqual([]);
      expect(tagsRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('resolveType', () => {
    it('знаходить тип за слагом', async () => {
      venueTypesRepo.findOne.mockResolvedValueOnce({ id: 'ty1', slug: 'bar' });
      const t = await service.resolveType('bar');
      expect(t).toEqual({ id: 'ty1', slug: 'bar' });
    });

    it('порожній/null слаг — null без запиту (зняття типу)', async () => {
      expect(await service.resolveType(null)).toBeNull();
      expect(await service.resolveType('   ')).toBeNull();
      expect(venueTypesRepo.findOne).not.toHaveBeenCalled();
    });

    it('невідомий слаг — 400', async () => {
      venueTypesRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.resolveType('bogus')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('write* — повна заміна привʼязок', () => {
    // em — «транзакція викликача»: усі записи йдуть через неї, репозиторії
    // при наявному em не чіпаються.
    let em: any;
    beforeEach(() => {
      em = { save: jest.fn(), delete: jest.fn() };
    });

    it('writeFeatures: delete старих + save нових; порожній набір — delete без save', async () => {
      await service.writeFeatures(
        'v1',
        [{ id: 'f2', code: 'terrace' } as any],
        em,
      );
      expect(em.delete).toHaveBeenCalledWith(VenueFeatureAssignment, {
        venueId: 'v1',
      });
      expect(em.save).toHaveBeenCalledWith(VenueFeatureAssignment, [
        { venueId: 'v1', featureId: 'f2' },
      ]);

      em.save.mockClear();
      em.delete.mockClear();
      await service.writeFeatures('v1', [], em);
      expect(em.delete).toHaveBeenCalledTimes(1);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('writeTags: delete старих + save нових', async () => {
      await service.writeTags('v1', [{ id: 't1', slug: 'kraft' } as any], em);
      expect(em.delete).toHaveBeenCalledWith(VenueTag, { venueId: 'v1' });
      expect(em.save).toHaveBeenCalledWith(VenueTag, [
        { venueId: 'v1', tagId: 't1' },
      ]);
    });

    it('writeType: null знімає привʼязку без save, тип — save', async () => {
      await service.writeType('v1', null, em);
      expect(em.delete).toHaveBeenCalledWith(VenueTypeAssignment, {
        venueId: 'v1',
      });
      expect(em.save).not.toHaveBeenCalled();

      await service.writeType('v1', { id: 'ty1', slug: 'bar' } as any, em);
      expect(em.save).toHaveBeenCalledWith(VenueTypeAssignment, {
        venueId: 'v1',
        typeId: 'ty1',
      });
    });
  });
});
