import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { Favorite } from './entities/favorite.entity';
import { VenuesService } from '../venues/venues.service';

const favoriteRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
  }),
});

/** Мок спільної перевірки venues.service: несхвалений/відсутній = 404. */
const venuesServiceMock = (approved: boolean) => ({
  findByIdApprovedOrThrow:
    approved === true
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn().mockRejectedValue(new NotFoundException('Заклад не знайдено')), // prettier-ignore
});

const buildModule = async (favorites: any, venuesService: any) => {
  const module = await Test.createTestingModule({
    providers: [
      FavoritesService,
      { provide: getRepositoryToken(Favorite), useValue: favorites },
      { provide: VenuesService, useValue: venuesService },
    ],
  }).compile();
  return module.get(FavoritesService);
};

describe('FavoritesService', () => {
  it('add saves when new', async () => {
    const favorites = favoriteRepo();
    favorites.findOne.mockResolvedValueOnce(null);
    const service = await buildModule(favorites, venuesServiceMock(true));
    await service.add('u1', 'v1');
    expect(favorites.save).toHaveBeenCalledWith({
      userId: 'u1',
      venueId: 'v1',
    });
  });

  it('add is idempotent (no error if already exists)', async () => {
    const favorites = favoriteRepo();
    favorites.findOne.mockResolvedValueOnce({ userId: 'u1', venueId: 'v1' });
    const service = await buildModule(favorites, venuesServiceMock(true));
    await service.add('u1', 'v1');
    expect(favorites.save).not.toHaveBeenCalled();
  });

  it('add викликає спільну перевірку закладу перед save', async () => {
    const favorites = favoriteRepo();
    const venuesService = venuesServiceMock(true);
    favorites.findOne.mockResolvedValueOnce(null);
    const service = await buildModule(favorites, venuesService);
    await service.add('u1', 'v1');
    expect(venuesService.findByIdApprovedOrThrow).toHaveBeenCalledWith('v1');
  });

  it('add throws 404 when venue check fails (не існує або не схвалений)', async () => {
    const favorites = favoriteRepo();
    const service = await buildModule(favorites, venuesServiceMock(false));
    await expect(service.add('u1', 'v1')).rejects.toThrow(NotFoundException);
    expect(favorites.save).not.toHaveBeenCalled();
  });
});
