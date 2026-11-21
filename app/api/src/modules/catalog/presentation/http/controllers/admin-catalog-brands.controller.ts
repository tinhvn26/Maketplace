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
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CatalogTaxonomyService } from '../../../application/taxonomy/catalog-taxonomy.service.js';
import type {
  CatalogActor,
  CatalogMutationContext,
} from '../../../application/ports/catalog-actor.js';
import {
  CreateBrandRequest,
  UpdateBrandRequest,
  ProductVersionRequest,
} from '../dto/catalog.requests.js';
import { CatalogAdminGuard } from '../guards/catalog-admin.guard.js';
import { CatalogExceptionFilter } from '../filters/catalog-exception.filter.js';

function context(request: Request, action: string): CatalogMutationContext {
  const actor = request as Request & CatalogActor;
  return { actor: { userId: actor.userId, role: actor.role }, action };
}

@Controller('admin/catalog/brands')
@UseGuards(CatalogAdminGuard)
@UseFilters(CatalogExceptionFilter)
export class AdminCatalogBrandsController {
  constructor(private readonly taxonomy: CatalogTaxonomyService) {}
  @Get() list() {
    return this.taxonomy.listBrands();
  }
  @Get(':id') get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.taxonomy.getBrand(id);
  }
  @Post() create(@Body() body: CreateBrandRequest, @Req() request: Request) {
    return this.taxonomy.createBrand(body, context(request, 'BRAND_CREATE'));
  }
  @Patch(':id') update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateBrandRequest,
    @Req() request: Request,
  ) {
    return this.taxonomy.updateBrand(
      id,
      body,
      context(request, 'BRAND_UPDATE'),
    );
  }
  @Delete(':id') @HttpCode(204) delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ProductVersionRequest,
    @Req() request: Request,
  ) {
    return this.taxonomy.deleteBrand(
      id,
      body,
      context(request, 'BRAND_DELETE'),
    );
  }
}
