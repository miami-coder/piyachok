import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ComplaintsService } from './complaints.service';
import { Complaint } from './entities/complaint.entity';
import { ApiPaginatedResponse } from '../../common/swagger/response-helpers';

/**
 * Скарги до закладу для адміна закладу (власника) — у кабінеті,
 * /me/venues/:id/complaints. Супер-адмін (complaint:manage) теж має доступ.
 */
@ApiTags('Me · Venue Complaints')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VenueComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get('me/venues/:id/complaints')
  @Permissions('venue:edit:own', 'complaint:manage')
  @ApiOperation({ summary: 'Скарги до закладу (власник або супер-адмін)' })
  @ApiPaginatedResponse({
    type: Complaint,
    description: 'Сторінкований список скарг до закладу',
  })
  @ApiUnauthorizedResponse({ description: 'Не авторизований' })
  @ApiForbiddenResponse({ description: 'Немає доступу до скарг цього закладу' })
  @ApiNotFoundResponse({ description: 'Закладу не знайдено' })
  list(
    @CurrentUser() u: JwtUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() q: PaginationQueryDto,
  ) {
    return this.complaints
      .assertCanViewForVenue(u.sub, id)
      .then(() => this.complaints.listForVenue(id, q.page, q.limit));
  }
}
