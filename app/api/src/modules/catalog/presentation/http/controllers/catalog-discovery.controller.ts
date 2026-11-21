import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { CatalogQueryService } from '../../../application/query/catalog-query.service.js';
import { CatalogTaxonomyService } from '../../../application/taxonomy/catalog-taxonomy.service.js';
import { BrowseProductsRequest } from '../dto/catalog.requests.js';
import { CatalogExceptionFilter } from '../filters/catalog-exception.filter.js';

@Controller('catalog')
@UseFilters(CatalogExceptionFilter)
export class CatalogDiscoveryController {
  constructor(
    private readonly query: CatalogQueryService,
    private readonly taxonomy: CatalogTaxonomyService,
  ) {}
  @Get('brands') listBrands() {
    return this.taxonomy
      .listBrands()
      .then((brands) => brands.map(({ version: _version, ...brand }) => brand));
  }
  @Get('categories/tree') categoryTree() {
    return this.query.listCategoryTree();
  }
  @Get('browse') browse(@Query() query: BrowseProductsRequest) {
    return this.query.browseProducts(query);
  }
}
