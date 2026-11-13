// src/modules/complaints/venue-complaints.controller.spec.ts — контролер делегує в сервіс;
// хто бачить скарги (власник або complaint:manage) тестується в complaints.service.spec.ts
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { VenueComplaintsController } from './venue-complaints.controller';
import { ComplaintsService } from './complaints.service';
import { PermissionsService } from '../rbac/permissions.service';
import { makePermsMock } from '../../testing/permissions-mock';

describe('VenueComplaintsController', () => {
  let controller: VenueComplaintsController;
  let complaints: any;

  beforeEach(async () => {
    complaints = {
      assertCanViewForVenue: jest.fn().mockResolvedValue(undefined),
      listForVenue: jest.fn().mockResolvedValue({ data: [], meta: undefined }),
    };
    const module = await Test.createTestingModule({
      controllers: [VenueComplaintsController],
      providers: [
        { provide: ComplaintsService, useValue: complaints },
        { provide: PermissionsService, useValue: makePermsMock() },
        Reflector,
      ],
    }).compile();
    controller = module.get(VenueComplaintsController);
  });

  it('перевірка доступу в сервісі, далі делегування listForVenue', async () => {
    complaints.listForVenue.mockResolvedValue({
      data: [{ id: 'c1' }],
      meta: { total: 1 },
    });
    const res = await controller.list({ sub: 'u1' } as any, 'v1', {
      page: 1,
      limit: 20,
    } as any);
    expect(complaints.assertCanViewForVenue).toHaveBeenCalledWith('u1', 'v1');
    expect(complaints.listForVenue).toHaveBeenCalledWith('v1', 1, 20);
    expect(res.data).toEqual([{ id: 'c1' }]);
  });

  it('доступ не пройшов → помилка сервісу і listForVenue не викликається', async () => {
    complaints.assertCanViewForVenue.mockRejectedValueOnce(
      new Error('forbidden'),
    );
    await expect(
      controller.list({ sub: 'u1' } as any, 'v1', {
        page: 1,
        limit: 20,
      } as any),
    ).rejects.toThrow('forbidden');
    expect(complaints.listForVenue).not.toHaveBeenCalled();
  });
});
