import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { ShopStatus } from '../../../domain/entities/shop.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const slug = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateShopRequest {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @Transform(slug)
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(180)
  slug!: string;
}

export class ShopVersionRequest {
  @IsInt() @Min(0) @Max(2147483646) version!: number;
}

export class UpdateShopRequest extends ShopVersionRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(slug)
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(180)
  slug?: string;
}

export class UpdateShopStatusRequest extends ShopVersionRequest {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: ShopStatus;
}
