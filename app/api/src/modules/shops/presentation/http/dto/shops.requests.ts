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
  @Transform(trim)
  @IsString({ message: 'name phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'name không được để trống.' })
  @MaxLength(100, { message: 'name không được vượt quá $constraint1 ký tự.' })
  name!: string;
  @Transform(slug)
  @IsString({ message: 'slug phải là chuỗi ký tự.' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug chỉ được chứa chữ cái thường, chữ số và dấu gạch ngang; không được bắt đầu, kết thúc hoặc có hai dấu gạch ngang liên tiếp.',
  })
  @MaxLength(180, { message: 'slug không được vượt quá $constraint1 ký tự.' })
  slug!: string;
}

export class ShopVersionRequest {
  @IsInt({ message: 'version phải là số nguyên.' })
  @Min(0, { message: 'version phải lớn hơn hoặc bằng $constraint1.' })
  @Max(2147483646, { message: 'version phải nhỏ hơn hoặc bằng $constraint1.' })
  version!: number;
}

export class UpdateShopRequest extends ShopVersionRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: 'name phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'name không được để trống.' })
  @MaxLength(100, { message: 'name không được vượt quá $constraint1 ký tự.' })
  name?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(slug)
  @IsString({ message: 'slug phải là chuỗi ký tự.' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug chỉ được chứa chữ cái thường, chữ số và dấu gạch ngang; không được bắt đầu, kết thúc hoặc có hai dấu gạch ngang liên tiếp.',
  })
  @MaxLength(180, { message: 'slug không được vượt quá $constraint1 ký tự.' })
  slug?: string;
}

export class UpdateShopStatusRequest extends ShopVersionRequest {
  @IsIn(['ACTIVE', 'SUSPENDED'], {
    message: 'status phải là ACTIVE hoặc SUSPENDED.',
  })
  status!: ShopStatus;
}
