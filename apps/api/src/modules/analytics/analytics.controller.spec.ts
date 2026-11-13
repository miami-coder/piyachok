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

  it('recordView делегує sessionId і загортає в data', async () => {
    analytics.recordView.mockResolvedValue({ views: 1 });
    const res = await controller.recordView('v1', { sessionId: 's1' } as any);
    expect(analytics.recordView).toHaveBeenCalledWith('v1', null, 's1');
    expect(res.data).toEqual({ views: 1 });
  });

  // Ідентичність дедупа — тільки userId/sessionId (див. AnalyticsService),
  // заголовки запиту контролер не читає: ними керує сам клієнт
  it('recordView без sessionId делегує null замість IP-фолбеку', async () => {
    analytics.recordView.mockResolvedValue({ recorded: true });
    await controller.recordView('v1', {} as any);
    expect(analytics.recordView).toHaveBeenCalledWith('v1', null, null);
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
