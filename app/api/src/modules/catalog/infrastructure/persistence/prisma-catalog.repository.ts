import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { Brand } from '../../domain/entities/brand.js';
import type { Category } from '../../domain/entities/category.js';
import type { ProductSnapshot } from '../../domain/entities/product.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import type {
  AdminProductListQuery,
  CatalogBrowseQuery,
  CatalogRepository,
  ProductListQuery,
} from '../../application/ports/catalog.repository.js';
import { retryCatalogWrite } from './catalog-persistence.shared.js';
import { PrismaBrandRepository } from './prisma-brand.repository.js';
import { PrismaCategoryRepository } from './prisma-category.repository.js';
import { PrismaProductRepository } from './prisma-product.repository.js';

/** One `CatalogRepository` port over the category, brand and product adapters. */
@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  private readonly categories: PrismaCategoryRepository;
  private readonly brands: PrismaBrandRepository;
  private readonly products: PrismaProductRepository;

  constructor(private readonly prisma: PrismaService) {
    this.categories = new PrismaCategoryRepository(prisma);
    this.brands = new PrismaBrandRepository(prisma);
    this.products = new PrismaProductRepository(prisma);
  }

  runInTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return retryCatalogWrite(() => this.prisma.$transaction(work));
  }

  listCategories() {
    return this.categories.listCategories();
  }
  findCategoryById(id: string) {
    return this.categories.findCategoryById(id);
  }
  createCategory(category: Category, context: CatalogMutationContext) {
    return this.categories.createCategory(category, context);
  }
  saveCategory(
    category: Category,
    expectedVersion: number,
    context: CatalogMutationContext,
  ) {
    return this.categories.saveCategory(category, expectedVersion, context);
  }
  deleteCategory(
    id: string,
    expectedVersion: number,
    context: CatalogMutationContext,
  ) {
    return this.categories.deleteCategory(id, expectedVersion, context);
  }

  listBrands() {
    return this.brands.listBrands();
  }
  findBrandById(id: string) {
    return this.brands.findBrandById(id);
  }
  createBrand(brand: Brand, context: CatalogMutationContext) {
    return this.brands.createBrand(brand, context);
  }
  saveBrand(
    brand: Brand,
    expectedVersion: number,
    context: CatalogMutationContext,
  ) {
    return this.brands.saveBrand(brand, expectedVersion, context);
  }
  deleteBrand(
    id: string,
    expectedVersion: number,
    context: CatalogMutationContext,
  ) {
    return this.brands.deleteBrand(id, expectedVersion, context);
  }

  findProductById(id: string) {
    return this.products.findProductById(id);
  }
  findPublishedProductBySlug(slug: string) {
    return this.products.findPublishedProductBySlug(slug);
  }
  listPublishedProducts(query: ProductListQuery) {
    return this.products.listPublishedProducts(query);
  }
  browsePublishedProducts(query: CatalogBrowseQuery) {
    return this.products.browsePublishedProducts(query);
  }
  listAdminProducts(query: AdminProductListQuery) {
    return this.products.listAdminProducts(query);
  }
  createProduct(product: ProductSnapshot, context: CatalogMutationContext) {
    return this.products.createProduct(product, context);
  }
  saveProduct(
    product: ProductSnapshot,
    expectedVersion: number,
    context: CatalogMutationContext,
  ) {
    return this.products.saveProduct(product, expectedVersion, context);
  }
  persistProductInTransaction(
    tx: Prisma.TransactionClient,
    product: ProductSnapshot,
    expectedVersion: number,
    context: CatalogMutationContext,
  ) {
    return this.products.persistProductInTransaction(
      tx,
      product,
      expectedVersion,
      context,
    );
  }
}
