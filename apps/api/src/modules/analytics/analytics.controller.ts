import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AnalyticsRangeQueryDto,
  TimeseriesQueryDto,
  VenueStatsQueryDto,
} from './dto/query-analytics.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { RecordViewDto } from './dto/record-view.dto';

@ApiTags('Analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @Post('venues/:id/view')
  @ApiOperation({ summary: 'Записати перегляд закладу (з дедуплікацією)' })
  @ApiOkResponse({
    description: 'Чи було записано перегляд',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: { recorded: { type: 'boolean' } },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Заклад не знайдено' })
  recordView(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: RecordViewDto,
  ) {
    // Дедуп тільки за реальними ідентичностями (userId/sessionId) — див.
    // AnalyticsService.recordView: IP-заголовки клієнт задає сам, тому ними
    // дедупить не можна. Без sessionId записується recorded: false
    return this.analytics
      .recordView(id, null, dto.sessionId ?? null)
      .then((data) => ({ data }));
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('me/venues/:id/analytics')
  @Permissions('analytics:view:own', 'analytics:view:all')
  @ApiOperation({ summary: 'Аналітика закладу (власник або супер-адмін)' })
  @ApiOkResponse({
    description: 'Метрики переглядів та подій',
    schema: {
      type: 'object',
      properties: {
        totalViews: { type: 'number' },
        viewsByDay: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', example: '2026-08-01' },
              count: { type: 'number' },
            },
          },
        },
        eventsByType: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eventType: { type: 'string' },
              count: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Не авторизований' })
  @ApiForbiddenResponse({
    description: 'Немає доступу до аналітики цього закладу',
  })
  @ApiNotFoundResponse({ description: 'Заклад не знайдено' })
  getForVenue(
    @CurrentUser() u: JwtUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() q: AnalyticsRangeQueryDto,
  ) {
    // Хто бачить аналітику (власник або супер-адмін) вирішує сам сервіс
    return this.analytics.getForVenue(u.sub, id, q.from, q.to).then((data) => ({
      data,
    }));
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('admin/analytics/overview')
  @Permissions('analytics:view:all')
  @ApiOperation({ summary: 'Загальна аналітика по всій системі' })
  @ApiOkResponse({
    description: 'Загальні метрики',
    schema: {
      type: 'object',
      properties: {
        totalViews: { type: 'number' },
        totalEvents: { type: 'number' },
        eventsByType: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eventType: { type: 'string' },
              count: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Не авторизований' })
  @ApiForbiddenResponse({ description: 'Немає дозволу analytics:view:all' })
  getOverview() {
    return this.analytics.getOverview().then((data) => ({ data }));
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('admin/analytics/timeseries')
  @Permissions('analytics:view:all')
  @ApiOperation({ summary: 'Перегляди системи в розрізі часу' })
  @ApiOkResponse({
    description: 'Ряд `{date, count}` по періодах',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', example: '2026-08-01' },
              count: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Не авторизований' })
  @ApiForbiddenResponse({ description: 'Немає дозволу analytics:view:all' })
  @ApiBadRequestResponse({ description: 'Невалідна гранулярність' })
  getTimeseries(@Query() q: TimeseriesQueryDto) {
    return this.analytics
      .getTimeseries({
        from: q.from,
        to: q.to,
        granularity: q.granularity ?? 'day',
      })
      .then((data) => ({ data }));
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('admin/analytics/venues')
  @Permissions('analytics:view:all')
  @ApiOperation({ summary: 'Перегляди в розрізі закладів' })
  @ApiOkResponse({
    description: 'Топ закладів за переглядами',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              venueId: { type: 'string' },
              venueName: { type: 'string' },
              views: { type: 'number' },
            },
          },
        },
        meta: { type: 'object' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Не авторизований' })
  @ApiForbiddenResponse({ description: 'Немає дозволу analytics:view:all' })
  getVenueStats(@Query() q: VenueStatsQueryDto) {
    return this.analytics.getVenueStats(q);
  }
}
