import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Гранулярність часового ряду адмін-аналітики. */
export const GRANULARITIES = ['day', 'week', 'month'] as const;

export class AnalyticsRangeQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Дата з (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Дата по (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class TimeseriesQueryDto extends AnalyticsRangeQueryDto {
  @ApiPropertyOptional({ enum: GRANULARITIES })
  @IsOptional()
  @IsIn([...GRANULARITIES])
  granularity?: 'day' | 'week' | 'month';
}

export class VenueStatsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Дата з (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Дата по (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
