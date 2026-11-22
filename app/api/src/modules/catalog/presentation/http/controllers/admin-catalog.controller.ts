import {
  Body,
  Controller,
  Delete,
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
import { CatalogAdminService } from '../../../application/admin/catalog-admin.service.js';
import {
  AddVariantRequest,
  AdminListProductsRequest,
  CreateCategoryRequest,
  CreateProductRequest,
  ProductVersionRequest,
  UpdateCategoryRequest,
  UpdateProductRequest,
  UpdateVariantRequest,
} from '../dto/catalog.requests.js';
import { CatalogExceptionFilter } from '../filters/catalog-exception.filter.js';
import { CatalogAdminGuard } from '../guards/catalog-admin.guard.js';
import type { AuthenticatedRequest } from '../../../../identity/contracts/identity.http.js';
import { catalogContext } from '../catalog-actor.js';

@Controller('admin/catalog')
@UseGuards(CatalogAdminGuard)
@UseFilters(CatalogExceptionFilter)
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogAdminService) {}

  @Get('categories')
  async listCategories() {
    return this.catalog.listCategories();
  }

  @Get('categories/:id')
  async getCategory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.catalog.getCategory(id);
  }

  @Post('categories')
  async createCategory(
    @Body() request: CreateCategoryRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.createCategory(
      request,
      catalogContext(actor, 'CREATE_CATEGORY'),
    );
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: UpdateCategoryRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.updateCategory(
      id,
      request,
      catalogContext(actor, 'UPDATE_CATEGORY'),
    );
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: ProductVersionRequest,
    @Req() actor: AuthenticatedRequest,
  ): Promise<void> {
    await this.catalog.deleteCategory(
      id,
      request,
      catalogContext(actor, 'DELETE_CATEGORY'),
    );
  }

  @Post('products')
  async createProduct(
    @Body() request: CreateProductRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.createProduct(
      request,
      catalogContext(actor, 'CREATE_PRODUCT'),
    );
  }

  @Get('products')
  async listProducts(@Query() query: AdminListProductsRequest) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:id')
  async getProduct(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.catalog.getProduct(id);
  }

  @Patch('products/:id')
  async updateProduct(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: UpdateProductRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.updateProduct(
      id,
      request,
      catalogContext(actor, 'UPDATE_PRODUCT'),
    );
  }

  @Post('products/:id/variants')
  async addVariant(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: AddVariantRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.addVariant(
      id,
      request,
      catalogContext(actor, 'ADD_VARIANT'),
    );
  }

  @Patch('products/:id/variants/:variantId')
  async updateVariant(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('variantId', new ParseUUIDPipe({ version: '4' })) variantId: string,
    @Body() request: UpdateVariantRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.updateVariant(
      id,
      variantId,
      request,
      catalogContext(actor, 'UPDATE_VARIANT'),
    );
  }

  @Post('products/:id/publish')
  @HttpCode(200)
  async publishProduct(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: ProductVersionRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.publishProduct(
      id,
      request,
      catalogContext(actor, 'PUBLISH_PRODUCT'),
    );
  }

  @Post('products/:id/unpublish')
  @HttpCode(200)
  async unpublishProduct(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: ProductVersionRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.unpublishProduct(
      id,
      request,
      catalogContext(actor, 'UNPUBLISH_PRODUCT'),
    );
  }

  @Post('products/:id/archive')
  @HttpCode(200)
  async archiveProduct(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: ProductVersionRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.archiveProduct(
      id,
      request,
      catalogContext(actor, 'ARCHIVE_PRODUCT'),
    );
  }

  @Post('products/:id/restore')
  @HttpCode(200)
  async restoreProduct(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() request: ProductVersionRequest,
    @Req() actor: AuthenticatedRequest,
  ) {
    return this.catalog.restoreProduct(
      id,
      request,
      catalogContext(actor, 'RESTORE_PRODUCT'),
    );
  }
}
