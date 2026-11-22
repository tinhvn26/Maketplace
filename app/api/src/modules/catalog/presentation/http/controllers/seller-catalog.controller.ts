import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import type { AuthenticatedRequest } from '../../../../identity/contracts/identity.http.js';
import { CatalogSellerService } from '../../../application/seller/catalog-seller.service.js';
import {
  AddVariantRequest,
  AdminListProductsRequest,
  CreateProductRequest,
  ProductVersionRequest,
  UpdateProductRequest,
  UpdateVariantRequest,
} from '../dto/catalog.requests.js';
import { CatalogExceptionFilter } from '../filters/catalog-exception.filter.js';
import { CatalogSellerGuard } from '../guards/catalog-seller.guard.js';
import { catalogActor } from '../catalog-actor.js';

class SellerDetailsRequest extends UpdateProductRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483646, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  revisionVersion?: number;
}
class SellerAddVariantRequest extends AddVariantRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483646, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  revisionVersion?: number;
}
class SellerVariantRequest extends UpdateVariantRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483646, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  revisionVersion?: number;
}
class SellerVersionRequest extends ProductVersionRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483646, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  revisionVersion?: number;
}
const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller('seller/shops/:shopId/catalog/products')
@UseGuards(CatalogSellerGuard)
@UseFilters(CatalogExceptionFilter)
export class SellerCatalogController {
  constructor(private readonly catalog: CatalogSellerService) {}
  @Get()
  list(
    @Param('shopId', uuid()) shopId: string,
    @Query() query: AdminListProductsRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.list(shopId, query, catalogActor(request));
  }
  @Post()
  create(
    @Param('shopId', uuid()) shopId: string,
    @Body() input: CreateProductRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.create(shopId, input, catalogActor(request));
  }
  @Get(':id')
  get(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.get(shopId, id, catalogActor(request));
  }
  @Patch(':id')
  update(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Body() input: SellerDetailsRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.update(shopId, id, input, catalogActor(request));
  }
  @Post(':id/variants')
  add(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Body() input: SellerAddVariantRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.addVariant(shopId, id, input, catalogActor(request));
  }
  @Patch(':id/variants/:variantId')
  updateVariant(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Param('variantId', uuid()) variantId: string,
    @Body() input: SellerVariantRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.updateVariant(
      shopId,
      id,
      variantId,
      input,
      catalogActor(request),
    );
  }
  @Post(':id/submit')
  @HttpCode(200)
  submit(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Body() input: SellerVersionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.submit(shopId, id, input, catalogActor(request));
  }
  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Body() input: SellerVersionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.withdraw(shopId, id, input, catalogActor(request));
  }
  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Body() input: ProductVersionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.changeState(
      shopId,
      id,
      input,
      'ARCHIVE',
      catalogActor(request),
    );
  }
  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Body() input: ProductVersionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.changeState(
      shopId,
      id,
      input,
      'UNPUBLISH',
      catalogActor(request),
    );
  }
  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @Param('shopId', uuid()) shopId: string,
    @Param('id', uuid()) id: string,
    @Body() input: ProductVersionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.changeState(
      shopId,
      id,
      input,
      'RESTORE',
      catalogActor(request),
    );
  }
}
