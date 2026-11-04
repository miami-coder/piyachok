import { Test } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PermissionsService } from '../rbac/permissions.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analytics: any;

  beforeEach(async () => {
    analytics = {
      recordView: jest.fn(),
      getForVenue: jest.fn(),
      getOverview: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        // PermissionsService потрібен PermissionsGuardу з метаданих контролера
        {
          provide: PermissionsService,
          useValue: { hasPermission: jest.fn() },
        },
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

  // Хто бачить аналітику — власник чи супер-адмін — вирішує сервіс
  // (assertCanView у AnalyticsService), контролер просто делегує юзера.
  it('getForVenue делегує юзера і діапазон у сервіс', async () => {
    analytics.getForVenue.mockResolvedValue({ total: 5 });
    const res = await controller.getForVenue({ sub: 'u1' } as any, 'v1', {
      from: '2024-01-01',
      to: '2024-01-31',
    } as any);

    expect(analytics.getForVenue).toHaveBeenCalledWith(
      'u1',
      'v1',
      '2024-01-01',
      '2024-01-31',
    );
    expect(res.data).toEqual({ total: 5 });
  });

  it('getOverview delegates', async () => {
    analytics.getOverview.mockResolvedValue({ total: 10 });
    const res = await controller.getOverview();
    expect(analytics.getOverview).toHaveBeenCalled();
    expect(res.data).toEqual({ total: 10 });
  });
});