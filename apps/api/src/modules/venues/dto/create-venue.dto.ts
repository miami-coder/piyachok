import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ContactsDto {
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() instagram?: string;
  @IsOptional() @IsString() facebook?: string;
  @IsOptional() @IsString() website?: string;
}

export class CreateVenueDto {
  @IsString() @MinLength(3) name: string;
  // null у опційних полях PATCH — «очистити», тому типи допускають null
  // (@IsOptional() пропускає null без валідації; сервіс нормалізує порожнє).
  @IsOptional() @IsString() description?: string | null;
  @IsString() @MinLength(5) address: string;
  @IsOptional() @IsLatitude() @Type(() => Number) latitude?: number | null;
  @IsOptional() @IsLongitude() @Type(() => Number) longitude?: number | null;
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactsDto)
  contacts?: ContactsDto | null;
  @IsOptional() @IsObject() workingHours?: Record<string, string> | null;
  @IsOptional() @IsNumber() @Min(0) averageCheck?: number | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  featureCodes?: string[] | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tagSlugs?: string[] | null;
  @IsOptional() @IsString() typeSlug?: string | null;
}
