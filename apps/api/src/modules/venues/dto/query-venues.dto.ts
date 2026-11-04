import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
} from '../../../common/utils/pagination.util';

export type VenueSort = 'rating' | 'check' | 'newest' | 'name' | 'distance';

export class QueryVenuesDto {
  // @ApiProperty на кожному полі — єдине джерело свагера (дублюючі @ApiQuery
  // на контролерах знято).
  @ApiPropertyOptional({ description: 'Пошуковий запит' })
  @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional({ enum: ['1'], description: '«Рекомендовані критиком» (розділ /top)' })
  @IsOptional() @IsIn(['1']) recommended?: '1';
  @ApiPropertyOptional({ description: 'Фільтр за типом' })
  @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional({ description: 'CSL фіч csv' })
  @IsOptional() @IsString() feature?: string; // csv
  @ApiPropertyOptional({ description: 'CSL теги csv' })
  @IsOptional() @IsString() tag?: string; // csv
  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minCheck?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxCheck?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;
  @ApiPropertyOptional({ example: 50.45 })
  @IsOptional() @IsLatitude() @Type(() => Number) lat?: number;
  @ApiPropertyOptional({ example: 30.52 })
  @IsOptional() @IsLongitude() @Type(() => Number) lng?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0.1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  radiusKm?: number;
  @ApiPropertyOptional({ enum: ['rating', 'check', 'newest', 'name', 'distance'] })
  @IsOptional()
  @IsIn(['rating', 'check', 'newest', 'name', 'distance'])
  sort?: VenueSort;
  @ApiPropertyOptional({ type: Number, minimum: 1, default: DEFAULT_PAGE })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number =
    DEFAULT_PAGE;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = DEFAULT_LIMIT;
}
