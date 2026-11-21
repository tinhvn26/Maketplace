import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { CatalogQueryService } from '../../../application/query/catalog-query.service.js';
import { ListProductsRequest } from '../dto/catalog.requests.js';
import { CatalogExceptionFilter } from '../filters/catalog-exception.filter.js';

@Controller('catalog')
@UseFilters(CatalogExceptionFilter)
export class CatalogController {
  constructor(private readonly catalog: CatalogQueryService) {}

  @Get('categories')
  async listCategories() {
    return this.catalog.listCategories();
  }

  @Get('products')
  async listProducts(@Query() query: ListProductsRequest) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:slug')
  async getProduct(@Param('slug') slug: string) {
    return this.catalog.getProduct(slug);
  }
}
