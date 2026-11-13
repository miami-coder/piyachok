import { Type, Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { CreateVenueDto } from './create-venue.dto';

/**
 * Числове поле PATCH: рядок → число, порожній рядок → null (очистити, а не 0
 * після Number('')), null/відсутність → null.
 *
 * Порядок важливий: базовий @Type(() => Number) перетворює '' на 0 ДО
 * @Transform (перетворення типу завжди перед custom-трансформаціями), тому
 * перекриваємо його @Type(() => String) — null/undefined зберігається як є,
 * рядок лишається рядком, а @Transform вже робить число або null.
 */
const toNumberOrNull = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    return s === '' ? null : Number(s);
  }
  return Number(value);
};

export class UpdateVenueDto extends PartialType(CreateVenueDto) {
  @Type(() => String)
  @Transform(toNumberOrNull)
  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @Type(() => String)
  @Transform(toNumberOrNull)
  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  @Type(() => String)
  @Transform(toNumberOrNull)
  @IsOptional()
  @IsNumber()
  @Min(0)
  averageCheck?: number | null;
}
