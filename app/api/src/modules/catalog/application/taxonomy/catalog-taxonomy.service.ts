import { createBrand, updateBrand } from '../../domain/entities/brand.js';
import {
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import { catalogId } from '../../domain/policies/catalog-input.policy.js';
import { assertProductVersion } from '../shared/catalog-query.policy.js';
import type { CatalogTaxonomyRepository } from '../ports/catalog-taxonomy.repository.js';
import type {
  CatalogClock,
  CatalogIdGenerator,
} from '../ports/catalog-runtime.js';
import type { CatalogMutationContext } from '../ports/catalog-actor.js';

export class CatalogTaxonomyService {
  constructor(
    private readonly brands: CatalogTaxonomyRepository,
    private readonly clock: CatalogClock,
    private readonly ids: CatalogIdGenerator,
  ) {}

  listBrands() {
    return this.brands.listBrands();
  }

  async getBrand(id: string) {
    const brand = await this.brands.findBrandById(catalogId(id));
    if (!brand) throw new CatalogNotFoundError('Brand not found');
    return brand;
  }

  createBrand(
    input: { name: string; slug: string },
    context?: CatalogMutationContext,
  ) {
    return this.brands.createBrand(
      createBrand({ ...input, id: this.ids.next(), now: this.clock.now() }),
      context,
    );
  }

  async updateBrand(
    id: string,
    input: { version: number; name?: string; slug?: string },
    context?: CatalogMutationContext,
  ) {
    assertProductVersion(input.version);
    const brand = await this.getBrand(id);
    if (brand.version !== input.version)
      throw new CatalogVersionConflictError();
    return this.brands.saveBrand(
      updateBrand(brand, input),
      input.version,
      context,
    );
  }
  
  async deleteBrand(
    id: string,
    input: { version: number },
    context?: CatalogMutationContext,
  ) {
    assertProductVersion(input.version);
    const brand = await this.getBrand(id);
    if (brand.version !== input.version)
      throw new CatalogVersionConflictError();
    await this.brands.deleteBrand(brand.id, input.version, context);
  }
}
