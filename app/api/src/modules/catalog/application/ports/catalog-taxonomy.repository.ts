import type { Brand } from '../../domain/entities/brand.js';
import type { CatalogMutationContext } from './catalog-actor.js';

export interface CatalogTaxonomyRepository {
  listBrands(): Promise<Brand[]>;

  findBrandById(id: string): Promise<Brand | null>;

  createBrand(brand: Brand, context?: CatalogMutationContext): Promise<Brand>;

  saveBrand(
    brand: Brand,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<Brand>;
  
  deleteBrand(
    id: string,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<void>;
}
