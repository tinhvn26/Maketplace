import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { ProductStatus } from '../../../domain/entities/product.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeSlug = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CategoryAttributeDefinitionRequest {
  @IsString({ message: '$property phải là chuỗi' })
  @MaxLength(40, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  key!: string;
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMaxSize(50, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @IsString({ each: true, message: 'Mỗi phần tử của $property phải là chuỗi' })
  @MaxLength(80, {
    each: true,
    message: 'Mỗi phần tử của $property không được vượt quá $constraint1 ký tự',
  })
  values!: string[];
  @IsBoolean({ message: '$property phải là giá trị true hoặc false' })
  required!: boolean;
}

export class CreateCategoryRequest {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  parentId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMaxSize(10, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @ValidateNested({
    each: true,
    message: 'Mỗi phần tử của $property phải là đối tượng hợp lệ',
  })
  @Type(() => CategoryAttributeDefinitionRequest)
  attributeDefinitions?: CategoryAttributeDefinitionRequest[];
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(100, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name!: string;

  @Transform(normalizeSlug)
  @IsString({ message: '$property phải là chuỗi' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      '$property chỉ được gồm các nhóm chữ thường không dấu hoặc chữ số, ngăn cách bằng một dấu gạch ngang',
  })
  @MaxLength(180, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  slug!: string;
}

export class ProductImageRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  assetId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      disallow_auth: true,
    },
    {
      message:
        '$property phải là URL HTTP hoặc HTTPS hợp lệ và không chứa thông tin đăng nhập',
    },
  )
  @MaxLength(2048, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  thumbnailUrl?: string;
  @IsString({ message: '$property phải là chuỗi' })
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
      disallow_auth: true,
    },
    {
      message:
        '$property phải là URL HTTP hoặc HTTPS hợp lệ và không chứa thông tin đăng nhập',
    },
  )
  @MaxLength(2048, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  url!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: '$property phải là chuỗi' })
  @MaxLength(200, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  alt?: string;
}

export class CreateProductRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  shopId?: string;
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  brandId?: string | null;
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  categoryId!: string;

  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(160, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name!: string;

  @Transform(normalizeSlug)
  @IsString({ message: '$property phải là chuỗi' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      '$property chỉ được gồm các nhóm chữ thường không dấu hoặc chữ số, ngăn cách bằng một dấu gạch ngang',
  })
  @MaxLength(180, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  slug!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: '$property phải là chuỗi' })
  @MaxLength(5000, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMaxSize(10, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @ValidateNested({
    each: true,
    message: 'Mỗi phần tử của $property phải là đối tượng hợp lệ',
  })
  @Type(() => ProductImageRequest)
  images?: ProductImageRequest[];
}

export class ProductVersionRequest {
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483646, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  version!: number;
}

export class UpdateCategoryRequest extends ProductVersionRequest {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  parentId?: string | null;
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMaxSize(10, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @ValidateNested({
    each: true,
    message: 'Mỗi phần tử của $property phải là đối tượng hợp lệ',
  })
  @Type(() => CategoryAttributeDefinitionRequest)
  attributeDefinitions?: CategoryAttributeDefinitionRequest[];
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(100, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeSlug)
  @IsString({ message: '$property phải là chuỗi' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      '$property chỉ được gồm các nhóm chữ thường không dấu hoặc chữ số, ngăn cách bằng một dấu gạch ngang',
  })
  @MaxLength(180, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  slug?: string;
}

export class UpdateProductRequest extends ProductVersionRequest {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  brandId?: string | null;
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  categoryId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(160, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeSlug)
  @IsString({ message: '$property phải là chuỗi' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      '$property chỉ được gồm các nhóm chữ thường không dấu hoặc chữ số, ngăn cách bằng một dấu gạch ngang',
  })
  @MaxLength(180, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  slug?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: '$property phải là chuỗi' })
  @MaxLength(5000, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMaxSize(10, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @ValidateNested({
    each: true,
    message: 'Mỗi phần tử của $property phải là đối tượng hợp lệ',
  })
  @Type(() => ProductImageRequest)
  images?: ProductImageRequest[];
}

export class AddVariantRequest extends ProductVersionRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMaxSize(10, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @ValidateNested({
    each: true,
    message: 'Mỗi phần tử của $property phải là đối tượng hợp lệ',
  })
  @Type(() => ProductImageRequest)
  images?: ProductImageRequest[];
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(64, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  sku!: string;

  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(120, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name!: string;

  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483647, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  priceAmount!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: '$property phải là giá trị true hoặc false' })
  isActive?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: '$property phải là đối tượng' })
  attributes?: Record<string, string>;
}

export class UpdateVariantRequest extends ProductVersionRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMaxSize(10, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @ValidateNested({
    each: true,
    message: 'Mỗi phần tử của $property phải là đối tượng hợp lệ',
  })
  @Type(() => ProductImageRequest)
  images?: ProductImageRequest[];
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(120, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483647, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  priceAmount?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: '$property phải là giá trị true hoặc false' })
  isActive?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: '$property phải là đối tượng' })
  attributes?: Record<string, string>;
}

export class ListProductsRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  brandId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  shopId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string' || value.length > 4096) return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })
  @IsObject({ message: '$property phải là đối tượng' })
  attributes?: Record<string, string>;
  @Type(() => Number)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(1, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483647, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(1, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(100, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  limit = 20;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @MaxLength(100, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  q?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  categoryId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483647, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  minPrice?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483647, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  maxPrice?: number;

  @IsIn(['newest', 'price-asc', 'price-desc', 'name-asc'], {
    message: '$property phải là một trong các giá trị: $constraint1',
  })
  sort: 'newest' | 'price-asc' | 'price-desc' | 'name-asc' = 'newest';
}

export class AdminListProductsRequest extends ListProductsRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'], {
    message: '$property phải là một trong các giá trị: $constraint1',
  })
  status?: ProductStatus;
}

export class BrowseProductsRequest extends ListProductsRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: '$property phải là chuỗi' })
  @MaxLength(2048, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  cursor?: string;
}

export class CreateBrandRequest {
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(100, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name!: string;
  @Transform(normalizeSlug)
  @IsString({ message: '$property phải là chuỗi' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      '$property chỉ được gồm các nhóm chữ thường không dấu hoặc chữ số, ngăn cách bằng một dấu gạch ngang',
  })
  @MaxLength(180, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  slug!: string;
}
export class UpdateBrandRequest extends ProductVersionRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: '$property phải là chuỗi' })
  @IsNotEmpty({ message: '$property không được để trống' })
  @MaxLength(100, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  name?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeSlug)
  @IsString({ message: '$property phải là chuỗi' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      '$property chỉ được gồm các nhóm chữ thường không dấu hoặc chữ số, ngăn cách bằng một dấu gạch ngang',
  })
  @MaxLength(180, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  slug?: string;
}
