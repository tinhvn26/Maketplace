import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const optional = (_object: unknown, value: unknown) => value !== undefined;
// The domain maps null to "no value" for these fields.
const nullable = (_object: unknown, value: unknown) => value != null;
const uuid = { message: '$property phải là UUID phiên bản 4 hợp lệ.' };

export class CheckoutLineRequest {
  @IsUUID('4', uuid)
  variantId!: string;

  @IsInt({ message: 'quantity phải là số nguyên.' })
  @Min(1, { message: 'quantity phải lớn hơn hoặc bằng $constraint1.' })
  @Max(999, { message: 'quantity phải nhỏ hơn hoặc bằng $constraint1.' })
  quantity!: number;

  // Only declared (whitelist); the domain policy validates it, and rejects null with 400.
  @ValidateIf(optional)
  expectedUnitPriceAmount?: number;
}

export class ShippingAddressRequest {
  @Transform(trim)
  @IsString({ message: 'recipientName phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'recipientName không được để trống.' })
  @MaxLength(100, {
    message: 'recipientName không được vượt quá $constraint1 ký tự.',
  })
  recipientName!: string;

  @Matches(/^\+?[0-9]{7,15}$/, {
    message: 'phoneNumber phải gồm 7-15 chữ số, có thể bắt đầu bằng dấu +.',
  })
  phoneNumber!: string;

  @Transform(trim)
  @IsString({ message: 'addressLine phải là chuỗi ký tự.' })
  @MaxLength(300, {
    message: 'addressLine không được vượt quá $constraint1 ký tự.',
  })
  @Matches(/^[\s\S]{5,}$/, { message: 'addressLine cần ít nhất 5 ký tự.' })
  addressLine!: string;
}

export class PlaceOrderRequest {
  @Matches(/^[A-Za-z0-9_-]{8,100}$/, {
    message:
      'idempotencyKey gồm 8-100 chữ cái, chữ số, gạch ngang hoặc gạch dưới.',
  })
  idempotencyKey!: string;

  @IsArray({ message: 'lines phải là danh sách.' })
  @ArrayMinSize(1, { message: 'lines cần ít nhất $constraint1 phần tử.' })
  @ArrayMaxSize(100, { message: 'lines chỉ được tối đa $constraint1 phần tử.' })
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineRequest)
  lines!: CheckoutLineRequest[];

  @ValidateNested()
  @Type(() => ShippingAddressRequest)
  shippingAddress!: ShippingAddressRequest;

  @ValidateIf(nullable)
  @IsString({ message: 'note phải là chuỗi ký tự.' })
  @MaxLength(500, { message: 'note không được vượt quá $constraint1 ký tự.' })
  note?: string | null;
}

export class OrderVersionRequest {
  @IsInt({ message: 'version phải là số nguyên.' })
  @Min(0, { message: 'version phải lớn hơn hoặc bằng $constraint1.' })
  @Max(2147483646, { message: 'version phải nhỏ hơn hoặc bằng $constraint1.' })
  version!: number;
}

export class BuyerCancelRequest extends OrderVersionRequest {
  @ValidateIf(nullable)
  @IsString({ message: 'reason phải là chuỗi ký tự.' })
  @MaxLength(200, { message: 'reason không được vượt quá $constraint1 ký tự.' })
  reason?: string | null;
}

export class SellerCancelRequest extends OrderVersionRequest {
  @Transform(trim)
  @IsString({ message: 'reason phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'reason không được để trống.' })
  @MaxLength(200, { message: 'reason không được vượt quá $constraint1 ký tự.' })
  reason!: string;
}

export class OrderListQuery {
  @ValidateIf(optional)
  @IsString({ message: 'status phải là chuỗi ký tự.' })
  status?: string;

  @ValidateIf(optional)
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên.' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng $constraint1.' })
  @Max(2147483647, { message: 'page phải nhỏ hơn hoặc bằng $constraint1.' })
  page?: number;

  @ValidateIf(optional)
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng $constraint1.' })
  @Max(100, { message: 'limit phải nhỏ hơn hoặc bằng $constraint1.' })
  limit?: number;
}

export class AdminOrderListQuery extends OrderListQuery {
  /** A shop id (UUID v4) or the literal `platform`. */
  @ValidateIf(optional)
  @Matches(
    /^(platform|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
    { message: 'shopId phải là UUID phiên bản 4 hợp lệ hoặc "platform".' },
  )
  shopId?: string;

  @ValidateIf(optional)
  @IsUUID('4', uuid)
  buyerId?: string;
}
