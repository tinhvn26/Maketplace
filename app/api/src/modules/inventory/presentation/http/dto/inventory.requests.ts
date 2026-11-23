import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const optional = (_object: unknown, value: unknown) => value !== undefined;
const uuid = { message: '$property phải là UUID phiên bản 4 hợp lệ.' };
const MAX_QUANTITY = 1_000_000_000;

class VersionedRequest {
  @IsInt({ message: 'version phải là số nguyên.' })
  @Min(0, { message: 'version phải lớn hơn hoặc bằng $constraint1.' })
  @Max(2147483646, { message: 'version phải nhỏ hơn hoặc bằng $constraint1.' })
  version!: number;
}

export class CreateWarehouseRequest {
  @Transform(trim)
  @IsString({ message: 'name phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'name không được để trống.' })
  @MaxLength(100, { message: 'name không được vượt quá $constraint1 ký tự.' })
  name!: string;

  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/, {
    message:
      'code gồm 1-32 chữ cái, chữ số, gạch ngang hoặc gạch dưới và phải bắt đầu bằng chữ hoặc số.',
  })
  code!: string;

  @ValidateIf(optional)
  @IsInt({ message: 'priority phải là số nguyên.' })
  @Min(0, { message: 'priority phải lớn hơn hoặc bằng $constraint1.' })
  @Max(1000, { message: 'priority phải nhỏ hơn hoặc bằng $constraint1.' })
  priority?: number;
}

export class UpdateWarehouseRequest extends VersionedRequest {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString({ message: 'name phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'name không được để trống.' })
  @MaxLength(100, { message: 'name không được vượt quá $constraint1 ký tự.' })
  name?: string;

  @ValidateIf(optional)
  @IsInt({ message: 'priority phải là số nguyên.' })
  @Min(0, { message: 'priority phải lớn hơn hoặc bằng $constraint1.' })
  @Max(1000, { message: 'priority phải nhỏ hơn hoặc bằng $constraint1.' })
  priority?: number;

  @ValidateIf(optional)
  @IsBoolean({ message: 'isActive phải là true hoặc false.' })
  isActive?: boolean;
}

class StockChangeRequest {
  @IsUUID('4', uuid)
  warehouseId!: string;

  @IsUUID('4', uuid)
  variantId!: string;

  @Transform(trim)
  @IsString({ message: 'reason phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'reason không được để trống.' })
  @MaxLength(200, { message: 'reason không được vượt quá $constraint1 ký tự.' })
  reason!: string;
}

export class ReceiveStockRequest extends StockChangeRequest {
  @IsInt({ message: 'quantity phải là số nguyên.' })
  @Min(1, { message: 'quantity phải lớn hơn hoặc bằng $constraint1.' })
  @Max(MAX_QUANTITY, { message: 'quantity phải nhỏ hơn hoặc bằng $constraint1.' })
  quantity!: number;
}

export class AdjustStockRequest extends StockChangeRequest {
  @IsInt({ message: 'quantityDelta phải là số nguyên.' })
  @Min(-MAX_QUANTITY, { message: 'quantityDelta phải lớn hơn hoặc bằng $constraint1.' })
  @Max(MAX_QUANTITY, { message: 'quantityDelta phải nhỏ hơn hoặc bằng $constraint1.' })
  quantityDelta!: number;

  @IsInt({ message: 'version phải là số nguyên.' })
  @Min(0, { message: 'version phải lớn hơn hoặc bằng $constraint1.' })
  @Max(2147483646, { message: 'version phải nhỏ hơn hoặc bằng $constraint1.' })
  version!: number;
}

export class TransferStockRequest {
  @IsUUID('4', uuid)
  fromWarehouseId!: string;

  @IsUUID('4', uuid)
  toWarehouseId!: string;

  @IsUUID('4', uuid)
  variantId!: string;

  @IsInt({ message: 'quantity phải là số nguyên.' })
  @Min(1, { message: 'quantity phải lớn hơn hoặc bằng $constraint1.' })
  @Max(MAX_QUANTITY, { message: 'quantity phải nhỏ hơn hoặc bằng $constraint1.' })
  quantity!: number;

  @Transform(trim)
  @IsString({ message: 'reason phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'reason không được để trống.' })
  @MaxLength(200, { message: 'reason không được vượt quá $constraint1 ký tự.' })
  reason!: string;
}

export class StockQuery {
  @ValidateIf(optional)
  @IsUUID('4', uuid)
  warehouseId?: string;

  @ValidateIf(optional)
  @IsUUID('4', uuid)
  variantId?: string;

  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên.' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng $constraint1.' })
  @Max(2147483647, { message: 'page phải nhỏ hơn hoặc bằng $constraint1.' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng $constraint1.' })
  @Max(100, { message: 'limit phải nhỏ hơn hoặc bằng $constraint1.' })
  limit = 20;
}

export class AvailabilityQuery {
  /** Comma-separated variant ids: ?variantIds=a,b,c */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray({ message: 'variantIds phải là danh sách ngăn cách bằng dấu phẩy.' })
  @ArrayMinSize(1, { message: 'variantIds cần ít nhất $constraint1 phần tử.' })
  @ArrayMaxSize(100, { message: 'variantIds chỉ được tối đa $constraint1 phần tử.' })
  @IsUUID('4', { each: true, message: 'Mỗi variantId phải là UUID phiên bản 4 hợp lệ.' })
  variantIds!: string[];
}
