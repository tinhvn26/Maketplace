import {
  createCategory,
  updateCategory,
} from '../../domain/entities/category.js';
import type { Category } from '../../domain/entities/category.js';
import { Product } from '../../domain/entities/product.js';
import type { ProductSnapshot } from '../../domain/entities/product.js';
import { catalogId } from '../../domain/policies/catalog-input.policy.js';
import {
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import type {
  AddVariantInput,
  CreateCategoryInput,
  CreateProductInput,
  UpdateCategoryInput,
  ProductVersionInput,
  UpdateProductInput,
  UpdateVariantInput,
} from '../shared/catalog.inputs.js';
import {
  assertProductVersion,
  normalizeProductQuery,
} from '../shared/catalog-query.policy.js';
import type { CatalogPage } from '../shared/catalog-page.js';
import type {
  AdminProductListQuery,
  CatalogAdminRepository,
} from '../ports/catalog.repository.js';
import type {
  CatalogClock,
  CatalogIdGenerator,
} from '../ports/catalog-runtime.js';
import type { CatalogMutationContext } from '../ports/catalog-actor.js';
import type { MediaAssets } from '../../../media/contracts/media.api.js';
import type { ProductImageInput } from '../../domain/entities/product.js';

export class CatalogAdminService {
  constructor(
    private readonly catalog: CatalogAdminRepository,
    private readonly ids: CatalogIdGenerator,
    private readonly clock: CatalogClock,
    private readonly media?: MediaAssets,
  ) {}

  createCategory(input: CreateCategoryInput, context?: CatalogMutationContext) {
    const category = createCategory({
      id: this.ids.next(),
      name: input.name,
      slug: input.slug,
      parentId: input.parentId,
      attributeDefinitions: input.attributeDefinitions,
      now: this.clock.now(),
    });
    return context
      ? this.catalog.createCategory(category, context)
      : this.catalog.createCategory(category);
  }

  listCategories(): Promise<Category[]> {
    return this.catalog.listCategories();
  }

  async getCategory(id: string): Promise<Category> {
    const category = await this.catalog.findCategoryById(catalogId(id));
    if (!category) throw new CatalogNotFoundError('Category not found');
    return { ...category, createdAt: new Date(category.createdAt) };
  }

  async updateCategory(
    id: string,
    input: UpdateCategoryInput,
    context?: CatalogMutationContext,
  ): Promise<Category> {
    const current = await this.categoryForMutation(id, input.version);
    const category = updateCategory(current, {
      name: input.name,
      slug: input.slug,
      parentId: input.parentId,
      attributeDefinitions: input.attributeDefinitions,
    });
    return context
      ? this.catalog.saveCategory(category, input.version, context)
      : this.catalog.saveCategory(category, input.version);
  }

  async deleteCategory(
    id: string,
    input: ProductVersionInput,
    context?: CatalogMutationContext,
  ): Promise<void> {
    const current = await this.categoryForMutation(id, input.version);
    if (context)
      await this.catalog.deleteCategory(current.id, input.version, context);
    else await this.catalog.deleteCategory(current.id, input.version);
  }

  async createProduct(
    input: CreateProductInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    const product = Product.create({
      id: this.ids.next(),
      categoryId: input.categoryId,
      shopId: input.shopId,
      brandId: input.brandId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      images: await this.prepareImages(
        input.images,
        input.shopId ?? null,
        context,
      ),
      now: this.clock.now(),
    });
    await this.requireCategory(product.toSnapshot().categoryId);
    return context
      ? this.catalog.createProduct(product.toSnapshot(), context)
      : this.catalog.createProduct(product.toSnapshot());
  }

  async getProduct(id: string): Promise<ProductSnapshot> {
    const product = await this.catalog.findProductById(catalogId(id));
    if (!product) throw new CatalogNotFoundError('Product not found');
    return Product.restore(product).toSnapshot();
  }

  async listProducts(
    query: AdminProductListQuery,
  ): Promise<CatalogPage<ProductSnapshot>> {
    const normalized = normalizeProductQuery(query);
    const result = await this.catalog.listAdminProducts(normalized);
    return {
      ...result,
      page: normalized.page,
      limit: normalized.limit,
      pages: Math.ceil(result.total / normalized.limit),
    };
  }

  async updateProduct(
    id: string,
    input: UpdateProductInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.mutate(
      id,
      input.version,
      async (product) => {
        product.updateDetails(
          {
            name: input.name,
            slug: input.slug,
            description: input.description,
            categoryId: input.categoryId,
            brandId: input.brandId,
            images: await this.prepareImages(
              input.images,
              product.toSnapshot().shopId ?? null,
              context,
            ),
          },
          this.clock.now(),
        );
        if (input.categoryId !== undefined) {
          await this.requireCategory(product.toSnapshot().categoryId);
        }
      },
      context,
    );
  }

  addVariant(
    id: string,
    input: AddVariantInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.mutate(
      id,
      input.version,
      async (product) => {
        product.addVariant(
          {
            id: this.ids.next(),
            sku: input.sku,
            name: input.name,
            priceAmount: input.priceAmount,
            isActive: input.isActive,
            attributes: input.attributes,
            images: await this.prepareImages(
              input.images,
              product.toSnapshot().shopId ?? null,
              context,
            ),
          },
          this.clock.now(),
        );
      },
      context,
    );
  }

  updateVariant(
    id: string,
    variantId: string,
    input: UpdateVariantInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.mutate(
      id,
      input.version,
      async (product) => {
        product.updateVariant(
          variantId,
          {
            name: input.name,
            priceAmount: input.priceAmount,
            isActive: input.isActive,
            attributes: input.attributes,
            images: await this.prepareImages(
              input.images,
              product.toSnapshot().shopId ?? null,
              context,
            ),
          },
          this.clock.now(),
        );
      },
      context,
    );
  }

  publishProduct(
    id: string,
    input: ProductVersionInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.mutate(
      id,
      input.version,
      (product) => product.publish(this.clock.now()),
      context,
    );
  }

  archiveProduct(
    id: string,
    input: ProductVersionInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.mutate(
      id,
      input.version,
      (product) => product.archive(this.clock.now()),
      context,
    );
  }

  unpublishProduct(
    id: string,
    input: ProductVersionInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.mutate(
      id,
      input.version,
      (product) => product.unpublish(this.clock.now()),
      context,
    );
  }

  restoreProduct(
    id: string,
    input: ProductVersionInput,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.mutate(
      id,
      input.version,
      (product) => product.restoreToDraft(this.clock.now()),
      context,
    );
  }

  private async categoryForMutation(
    id: string,
    expectedVersion: number,
  ): Promise<Category> {
    assertProductVersion(expectedVersion);
    const category = await this.getCategory(id);
    if (category.version !== expectedVersion) {
      throw new CatalogVersionConflictError(
        'Category changed; reload and retry',
      );
    }
    return category;
  }

  private async requireCategory(id: string): Promise<void> {
    if (!(await this.catalog.findCategoryById(id))) {
      throw new CatalogNotFoundError('Category not found');
    }
  }

  private async mutate(
    id: string,
    expectedVersion: number,
    change: (product: Product) => void | Promise<void>,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    assertProductVersion(expectedVersion);
    const current = await this.getProduct(id);
    if (current.version !== expectedVersion) {
      throw new CatalogVersionConflictError(
        'Product changed; reload and retry',
      );
    }
    const product = Product.restore(current);
    await change(product);
    // Persistence repeats the version check atomically with all variant writes.
    return context
      ? this.catalog.saveProduct(product.toSnapshot(), expectedVersion, context)
      : this.catalog.saveProduct(product.toSnapshot(), expectedVersion);
  }

  private async prepareImages(
    images: ProductImageInput[] | undefined,
    shopId: string | null,
    context?: CatalogMutationContext,
  ) {
    if (
      images === undefined ||
      !Array.isArray(images) ||
      !context ||
      !this.media
    )
      return images;
    const ids = images.flatMap((image) =>
      image?.assetId ? [image.assetId] : [],
    );
    if (!ids.length) return images;
    const assets = await this.media.resolveForShop(shopId, context.actor, ids);
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return images.map((image) =>
      image.assetId && byId.has(image.assetId)
        ? {
            ...image,
            url: byId.get(image.assetId)!.url,
            thumbnailUrl: byId.get(image.assetId)!.thumbnailUrl,
          }
        : image,
    );
  }
}
