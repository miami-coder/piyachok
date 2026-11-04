import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { HangoutStatus } from '../entities/hangout.entity';

/** Роль поточного користувача в /me/hangouts. */
export const MY_HANGOUT_ROLES = ['created', 'joined', 'all'] as const;

export class HangoutListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Фільтр за закладом' })
  @IsOptional()
  @IsUUID('all')
  venueId?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Фільтр за датою (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @ApiPropertyOptional({ enum: Object.values(HangoutStatus) })
  @IsOptional()
  @IsIn(Object.values(HangoutStatus))
  status?: HangoutStatus;
}

export class MyHangoutsQueryDto {
  @ApiProperty({ enum: MY_HANGOUT_ROLES, required: true })
  @IsIn([...MY_HANGOUT_ROLES])
  role!: 'created' | 'joined' | 'all';
}
