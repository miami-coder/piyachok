import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export type ReviewSort = 'newest' | 'oldest' | 'highest' | 'lowest';

export class ReviewListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'highest', 'lowest'] })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'highest', 'lowest'])
  sort?: ReviewSort;
}

export class ReviewAdminQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Фільтр за закладом' })
  @IsOptional()
  @IsUUID('all')
  venueId?: string;
}
