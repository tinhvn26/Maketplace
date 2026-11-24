import type { Category } from '../../domain/entities/category.js';
import type {
  ProductSnapshot,
  ProductStatus,
} from '../../domain/entities/product.js';
import type { CatalogMutationContext } from './catalog-actor.js';
import type { CatalogTaxonomyRepository } from './catalog-taxonomy.repository.js';
import type { ProductImage } from '../../domain/entities/product.js';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name-asc';

export interface ProductListQuery {
  page: number;
  limit: number;
  q?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: ProductSort;
  shopId?: string;
  brandId?: string;
  attributes?: Record<string, string>;
}

export interface AdminProductListQuery extends ProductListQuery {
  status?: ProductStatus;
}

export interface ProductPage {
  items: ProductSnapshot[];
  total: number;
}

export interface ProductSummary {
  id: string;
  categoryId: string;
  shopId: string | null;
  brandId: string | null;
  name: string;
  slug: string;
  coverImage: ProductImage | null;
  priceFromAmount: number | null;
  currency: 'VND';
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export interface ProductSummaryPage {
  items: ProductSummary[];
  total: number;
}

export interface CatalogBrowseQuery extends Omit<ProductListQuery, 'page'> {
  cursor?: string;
}

export interface CatalogBrowsePage {
  items: ProductSummary[];
  hasNext: boolean;
  nextCursor: string | null;
}

export interface PublicCatalogReader {
  listCategories(): Promise<Category[]>;

  listPublishedProducts(query: ProductListQuery): Promise<ProductSummaryPage>;

  browsePublishedProducts(
    query: CatalogBrowseQuery,
  ): Promise<CatalogBrowsePage>;

  findPublishedProductBySlug(slug: string): Promise<ProductSnapshot | null>;
}

export interface CatalogAdminRepository {
  listCategories(): Promise<Category[]>;

  findCategoryById(id: string): Promise<Category | null>;

  createCategory(
    category: Category,
    context: CatalogMutationContext,
  ): Promise<Category>;

  saveCategory(
    category: Category,
    expectedVersion: number,
    context: CatalogMutationContext,
  ): Promise<Category>;

  deleteCategory(
    id: string,
    expectedVersion: number,
    context: CatalogMutationContext,
  ): Promise<void>;

  findProductById(id: string): Promise<ProductSnapshot | null>;

  listAdminProducts(query: AdminProductListQuery): Promise<ProductPage>;

  createProduct(
    product: ProductSnapshot,
    context: CatalogMutationContext,
  ): Promise<ProductSnapshot>;

  saveProduct(
    product: ProductSnapshot,
    expectedVersion: number,
    context: CatalogMutationContext,
  ): Promise<ProductSnapshot>;
}

export interface CatalogRepository
  extends
    PublicCatalogReader,
    CatalogAdminRepository,
    CatalogTaxonomyRepository {}
