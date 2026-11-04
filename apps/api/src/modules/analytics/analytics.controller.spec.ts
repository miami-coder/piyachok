import { Test } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { VenuesService } from '../venues/venues.service';
import { PermissionsService } from '../rbac/permissions.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analytics: any;
  let venues: any;
  let perms: any;

  beforeEach(async () => {
    analytics = {
      recordView: jest.fn(),
      getForVenue: jest.fn(),
      getOverview: jest.fn(),
    };
    venues = { findOneOrThrow: jest.fn() };
    perms = { hasPermission: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: VenuesService, useValue: venues },
        { provide: PermissionsService, useValue: perms },
      ],
    }).compile();
    controller = module.get(AnalyticsController);
  });

  it('recordView delegates and wraps in data', async () => {
    analytics.recordView.mockResolvedValue({ views: 1 });
    // headers без XFF → фолбек на socket-адресу req.ip
    const req = { headers: {}, ip: '203.0.113.7' } as any;
    const res = await controller.recordView(
      'v1',
      { sessionId: 's1' } as any,
      req,
    );
    expect(analytics.recordView).toHaveBeenCalledWith(
      'v1',
      null,
      's1',
      '203.0.113.7',
    );
    expect(res.data).toEqual({ views: 1 });
  });

  it('recordView без sessionId фолбекить на клієнтський IP з XFF', async () => {
    analytics.recordView.mockResolvedValue({ recorded: true });
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.9, 198.51.100.7' },
      ip: '172.17.0.5',
    } as any;
    await controller.recordView('v1', {} as any, req);
    // останнє значення ланцюга — реальний клієнт (дописує довірений проксі)
    expect(analytics.recordView).toHaveBeenCalledWith(
      'v1',
      null,
      null,
      '198.51.100.7',
    );
  });

  it('getForVenue allows when user has analytics:view:all', async () => {
    perms.hasPermission.mockResolvedValue(true);
    analytics.getForVenue.mockResolvedValue({ total: 5 });
    const res = await controller.getForVenue(
      { sub: 'u1' } as any,
      'v1',
      '2024-01-01',
      '2024-01-31',
    );
    expect(perms.hasPermission).toHaveBeenCalledWith(
      'u1',
      'analytics:view:all',
    );
    expect(venues.findOneOrThrow).not.toHaveBeenCalled();
    expect(analytics.getForVenue).toHaveBeenCalledWith(
      'v1',
      '2024-01-01',
      '2024-01-31',
    );
    expect(res.data).toEqual({ total: 5 });
  });

  it('getForVenue allows owner without analytics:view:all', async () => {
    perms.hasPermission.mockResolvedValue(false);
    venues.findOneOrThrow.mockResolvedValue({ ownerId: 'u1' });
    analytics.getForVenue.mockResolvedValue({ total: 2 });
    const res = await controller.getForVenue({ sub: 'u1' } as any, 'v1');
    expect(venues.findOneOrThrow).toHaveBeenCalledWith('v1');
    expect(analytics.getForVenue).toHaveBeenCalledWith(
      'v1',
      undefined,
      undefined,
    );
    expect(res.data).toEqual({ total: 2 });
  });

  it('getForVenue throws ForbiddenException for non-owner', async () => {
    perms.hasPermission.mockResolvedValue(false);
    venues.findOneOrThrow.mockResolvedValue({ ownerId: 'other' });
    await expect(
      controller.getForVenue({ sub: 'u1' } as any, 'v1'),
    ).rejects.toThrow('Немає доступу до аналітики цього закладу');
    expect(analytics.getForVenue).not.toHaveBeenCalled();
  });

  it('getOverview delegates', async () => {
    analytics.getOverview.mockResolvedValue({ total: 10 });
    const res = await controller.getOverview();
    expect(analytics.getOverview).toHaveBeenCalled();
    expect(res.data).toEqual({ total: 10 });
  });
});
