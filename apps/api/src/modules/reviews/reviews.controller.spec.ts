import { Test } from '@nestjs/testing';
import { PermissionsService } from '../rbac/permissions.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

describe('ReviewsController', () => {
  let controller: ReviewsController;
  let reviews: any;

  beforeEach(async () => {
    reviews = {
      create: jest.fn(),
      assertCanCreate: jest.fn(),
      listForVenue: jest.fn(),
      findOneOrThrow: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      feature: jest.fn(),
      listForUser: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [
        {
          provide: PermissionsService,
          useValue: { hasAnyPermission: jest.fn().mockResolvedValue(true) },
        },
        { provide: ReviewsService, useValue: reviews },
      ],
    }).compile();
    controller = module.get(ReviewsController);
  });

  it('create делегує у сервіс разом із файлом чека', async () => {
    reviews.create.mockResolvedValue({ id: 'r1', checkPhotoUrl: null });
    const res = await controller.create({ sub: 'u1' } as any, 'v1', {
      rating: 5,
      text: 'Чудово! Все сподобалось',
    });
    expect(res.data.id).toBe('r1');
    expect(reviews.create).toHaveBeenCalledWith(
      'u1',
      'v1',
      { rating: 5, text: 'Чудово! Все сподобалось' },
      undefined,
    );
  });

  it('list delegates', async () => {
    reviews.listForVenue.mockResolvedValue({ data: [], meta: { total: 0 } });
    await controller.list('v1', { page: 1, limit: 20 } as any);
    expect(reviews.listForVenue).toHaveBeenCalledWith('v1', 1, 20, undefined);
  });
});
