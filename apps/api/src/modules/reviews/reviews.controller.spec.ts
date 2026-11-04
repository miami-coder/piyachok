import { Test } from '@nestjs/testing';
import { PermissionsService } from '../rbac/permissions.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { FileStorageService } from '../../common/services/file-storage.service';

describe('ReviewsController', () => {
  let controller: ReviewsController;
  let reviews: any;
  let storage: any;

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
    storage = { save: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [
        {
          provide: PermissionsService,
          useValue: { hasAnyPermission: jest.fn().mockResolvedValue(true) },
        },
        { provide: ReviewsService, useValue: reviews },
        { provide: FileStorageService, useValue: storage },
      ],
    }).compile();
    controller = module.get(ReviewsController);
  });

  it('create delegates', async () => {
    reviews.assertCanCreate.mockResolvedValue(undefined);
    reviews.create.mockResolvedValue({ id: 'r1' });
    const res = await controller.create({ sub: 'u1' } as any, 'v1', {
      rating: 5,
      text: 'Чудово! Все сподобалось',
    });
    expect(res.data.id).toBe('r1');
  });

  it('create checks first, saves file only after checks pass', async () => {
    reviews.assertCanCreate.mockResolvedValue(undefined);
    reviews.create.mockResolvedValue({ id: 'r1' });
    storage.save.mockResolvedValue({ url: '/static/x.jpg', filename: 'x.jpg' });
    const file = { originalname: 'a.jpg', mimetype: 'image/jpeg', size: 1, buffer: Buffer.alloc(1) } as any;
    await controller.create({ sub: 'u1' } as any, 'v1', { rating: 5, text: 'ok' }, file);
    expect(reviews.assertCanCreate).toHaveBeenCalledWith('u1', 'v1');
    expect(reviews.create).toHaveBeenCalledWith(
      'u1',
      'v1',
      expect.objectContaining({ checkPhotoUrl: '/static/x.jpg' }),
    );
    // Порядок: перевірки суворо до збереження файла.
    expect(reviews.assertCanCreate.mock.invocationCallOrder[0]).toBeLessThan(
      storage.save.mock.invocationCallOrder[0],
    );
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('create does not save the file when checks reject', async () => {
    reviews.assertCanCreate.mockRejectedValue(new Error('403'));
    const file = { originalname: 'a.jpg', mimetype: 'image/jpeg', size: 1, buffer: Buffer.alloc(1) } as any;
    await expect(
      controller.create({ sub: 'u1' } as any, 'v1', { rating: 5, text: 'ok' }, file),
    ).rejects.toThrow('403');
    expect(storage.save).not.toHaveBeenCalled();
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('create removes the saved file when the review fails after it', async () => {
    reviews.assertCanCreate.mockResolvedValue(undefined);
    reviews.create.mockRejectedValue(new Error('409'));
    storage.save.mockResolvedValue({ url: '/static/x.jpg', filename: 'x.jpg' });
    const file = { originalname: 'a.jpg', mimetype: 'image/jpeg', size: 1, buffer: Buffer.alloc(1) } as any;
    await expect(
      controller.create({ sub: 'u1' } as any, 'v1', { rating: 5, text: 'ok' }, file),
    ).rejects.toThrow('409');
    expect(storage.remove).toHaveBeenCalledWith('reviews/v1', 'x.jpg');
  });

  it('list delegates', async () => {
    reviews.listForVenue.mockResolvedValue({ data: [], meta: { total: 0 } });
    await controller.list('v1', { page: 1, limit: 20 } as any);
    expect(reviews.listForVenue).toHaveBeenCalledWith('v1', 1, 20, undefined);
  });
});
