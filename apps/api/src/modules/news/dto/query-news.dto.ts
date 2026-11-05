import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { NewsStatus } from '../entities/news.entity';

/** Статуси, які приймає ?status= в адмін-списку новин. */
export const NEWS_LIST_STATUSES = [
  NewsStatus.Draft,
  NewsStatus.Published,
  NewsStatus.Archived,
] as const;

export class NewsListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Фільтр за категорією' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Фільтр за закладом' })
  @IsOptional()
  @IsUUID('all')
  venueId?: string;

  @ApiPropertyOptional({
    enum: ['true'],
    description: "'true' — лише промотовані",
  })
  @IsOptional()
  @IsIn(['true'])
  isPromoted?: 'true';
}

export class NewsAdminQueryDto extends NewsListQueryDto {
  @ApiPropertyOptional({ enum: NEWS_LIST_STATUSES })
  @IsOptional()
  @IsIn([...NEWS_LIST_STATUSES])
  status?: NewsStatus;
}
