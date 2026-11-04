import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
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
import { AnalyticsService, type Granularity } from './analytics.service';
import { RecordViewDto } from './dto/record-view.dto';
import { VenuesService } from '../venues/venues.service';
import { PermissionsService } from '../rbac/permissions.service';

/**
 * Клієнтський IP для фолбек-дедупа переглядів: останнє значення
 * X-Forwarded-For дописує найближчий довірений проксі (підміна перших
 * елементів ланцюга на результат не впливає), далі — socket-адреса.
 * Глобальний trust proxy навмисно не вмикається: req.ip, яким керується
 * тротлер, має лишатися адресою проксі, а не клієнта.
 */
function clientIpOf(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  const last = Array.isArray(xff) ? xff[xff.length - 1] : xff?.split(',').pop();
  return last?.trim() || req.ip || null;
}

@ApiTags('Analytics')
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly venues: VenuesService,
    private readonly perms: PermissionsService,
  ) {}

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
    @Req() req: Request,
  ) {
    // Дедуп не покладається на клієнта: без sessionId фолбек — IP клієнта
    return this.analytics
      .recordView(id, null, dto.sessionId ?? null, clientIpOf(req))
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
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description: 'Дата з (ISO)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description: 'Дата по (ISO)',
  })
  getForVenue(
    @CurrentUser() u: JwtUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.assertOwnerOrAll(u.sub, id)
      .then(() => this.analytics.getForVenue(id, from, to))
      .then((data) => ({ data }));
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
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({
    name: 'granularity',
    required: false,
    enum: ['day', 'week', 'month'],
  })
  @ApiUnauthorizedResponse({ description: 'Не авторизований' })
  @ApiForbiddenResponse({ description: 'Немає дозволу analytics:view:all' })
  @ApiBadRequestResponse({ description: 'Невалідна гранулярність' })
  getTimeseries(
    @Query()
    q: {
      from?: string;
      to?: string;
      granularity?: string;
    },
  ) {
    const granularity = (['day', 'week', 'month'] as const).find(
      (g) => g === (q.granularity ?? 'day'),
    );
    if (!granularity)
      throw new BadRequestException('Невалідна гранулярність: day|week|month');
    return this.analytics
      .getTimeseries({
        from: q.from,
        to: q.to,
        granularity: granularity as Granularity,
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
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiUnauthorizedResponse({ description: 'Не авторизований' })
  @ApiForbiddenResponse({ description: 'Немає дозволу analytics:view:all' })
  getVenueStats(
    @Query()
    q: {
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return this.analytics.getVenueStats(q);
  }

  private async assertOwnerOrAll(userId: string, venueId: string) {
    if (await this.perms.hasPermission(userId, 'analytics:view:all')) return;
    const venue = await this.venues.findOneOrThrow(venueId);
    if (venue.ownerId !== userId) {
      throw new ForbiddenException('Немає доступу до аналітики цього закладу');
    }
  }
}
