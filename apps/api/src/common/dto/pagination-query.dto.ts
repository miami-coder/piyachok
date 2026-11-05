import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { MAX_LIMIT } from '../utils/pagination.util';

/**
 * База list-ендпоінтів: page/limit — сирі строки з query, тому перетворення
 * @Type(() => Number) і межі (1…MAX_LIMIT) описує тип, а не clamp у сервісі.
 * Невалідне або нечислове значення = 400 від глобального ValidationPipe
 * (clamp у normalizePagination лишається як захист у глибину).
 *
 * Свагер читає поля класу через @ApiProperty — дублюючі @ApiQuery декоратори
 * на контролерах знято.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: Number,
    description: 'Номер сторінки',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    description: 'Розмір сторінки',
    minimum: 1,
    maximum: MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}
