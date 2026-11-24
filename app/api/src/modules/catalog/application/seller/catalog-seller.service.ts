import type { ShopAccess } from '../../../shops/contracts/shops.api.js';
import type { MediaAssets } from '../../../media/contracts/media.api.js';
import { Product } from '../../domain/entities/product.js';
import type {
  ProductImageInput,
  ProductSnapshot,
} from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogValidationError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import type {
  CatalogActor,
  CatalogMutationContext,
} from '../ports/catalog-actor.js';
import type {
  CatalogWorkflowRepository,
  SellerProductState,
} from '../ports/catalog-workflow.repository.js';
import type { CatalogSellerRepository } from '../ports/catalog-seller.repository.js';
import type {
  CatalogClock,
  CatalogIdGenerator,
} from '../ports/catalog-runtime.js';
import type {
  AddVariantInput,
  CreateProductInput,
  UpdateProductInput,
  UpdateVariantInput,
} from '../shared/catalog.inputs.js';
import { validateVariantsForCategory } from '../../domain/policies/category-attributes.policy.js';
import type { AdminProductListQuery } from '../ports/catalog.repository.js';
import { normalizeProductQuery } from '../shared/catalog-query.policy.js';

export interface SellerVersion {
  version: number;
  revisionVersion?: number;
}

export class CatalogSellerService {
  constructor(
    private readonly catalog: CatalogSellerRepository,
    private readonly workflow: CatalogWorkflowRepository,
    private readonly shops: ShopAccess,
    private readonly media: MediaAssets,
    private readonly ids: CatalogIdGenerator,
    private readonly clock: CatalogClock,
  ) {}

  async get(
    shopId: string,
    id: string,
    actor: CatalogActor,
  ): Promise<SellerProductState> {
    await this.shops.requireManageable(shopId, actor);
    const state = await this.workflow.load(id, shopId);
    if (!state)
      throw new CatalogNotFoundError('Product not found in this shop');
    return state;
  }

  async list(
    shopId: string,
    query: AdminProductListQuery,
    actor: CatalogActor,
  ) {
    await this.shops.requireManageable(shopId, actor);
    const normalized = normalizeProductQuery({ ...query, shopId });
    const result = await this.catalog.listAdminProducts(normalized);
    return {
      ...result,
      page: normalized.page,
      limit: normalized.limit,
      pages: Math.ceil(result.total / normalized.limit),
    };
  }

  async changeState(
    shopId: string,
    id: string,
    input: SellerVersion,
    action: 'ARCHIVE' | 'UNPUBLISH' | 'RESTORE',
    actor: CatalogActor,
  ) {
    const state = await this.get(shopId, id, actor);
    if (state.product.version !== input.version)
      throw new CatalogVersionConflictError();
    const product = Product.restore(state.product);
    if (action === 'ARCHIVE') product.archive(this.clock.now());
    else if (action === 'UNPUBLISH') product.unpublish(this.clock.now());
    else product.restoreToDraft(this.clock.now());
    const saved = await this.catalog.saveProduct(
      product.toSnapshot(),
      input.version,
      this.context(shopId, actor, `SELLER_${action}_PRODUCT`),
    );
    return { product: saved, revision: null };
  }

  async create(
    shopId: string,
    input: CreateProductInput,
    actor: CatalogActor,
  ): Promise<SellerProductState> {
    await this.shops.requireManageable(shopId, actor);
    if (input.shopId !== undefined && input.shopId !== shopId)
      throw new CatalogValidationError('Shop ID must match the route');
    const product = Product.create({
      id: this.ids.next(),
      shopId,
      categoryId: input.categoryId,
      brandId: input.brandId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      images: await this.images(shopId, actor, input.images ?? []),
      now: this.clock.now(),
    }).toSnapshot();
    await this.validateCategory(product);
    const saved = await this.catalog.createProduct(
      product,
      this.context(shopId, actor, 'SELLER_CREATE_PRODUCT'),
    );
    return { product: saved, revision: null };
  }

  update(
    shopId: string,
    id: string,
    input: UpdateProductInput & SellerVersion,
    actor: CatalogActor,
  ) {
    return this.mutate(shopId, id, input, actor, async (product) => {
      product.updateDetails(
        {
          name: input.name,
          slug: input.slug,
          categoryId: input.categoryId,
          brandId: input.brandId,
          description: input.description,
          images:
            input.images === undefined
              ? undefined
              : await this.images(shopId, actor, input.images),
        },
        this.clock.now(),
      );
    });
  }

  addVariant(
    shopId: string,
    id: string,
    input: AddVariantInput & SellerVersion,
    actor: CatalogActor,
  ) {
    return this.mutate(shopId, id, input, actor, async (product) =>
      product.addVariant(
        {
          id: this.ids.next(),
          sku: input.sku,
          name: input.name,
          priceAmount: input.priceAmount,
          isActive: input.isActive,
          attributes: input.attributes,
          images:
            input.images === undefined
              ? undefined
              : await this.images(shopId, actor, input.images),
        },
        this.clock.now(),
      ),
    );
  }

  updateVariant(
    shopId: string,
    id: string,
    variantId: string,
    input: UpdateVariantInput & SellerVersion,
    actor: CatalogActor,
  ) {
    return this.mutate(shopId, id, input, actor, async (product) =>
      product.updateVariant(
        variantId,
        {
          name: input.name,
          priceAmount: input.priceAmount,
          isActive: input.isActive,
          attributes: input.attributes,
          images:
            input.images === undefined
              ? undefined
              : await this.images(shopId, actor, input.images),
        },
        this.clock.now(),
      ),
    );
  }

  async submit(
    shopId: string,
    id: string,
    input: SellerVersion,
    actor: CatalogActor,
  ) {
    await this.get(shopId, id, actor);
    return this.workflow.submit(
      id,
      input.version,
      input.revisionVersion,
      this.context(shopId, actor, 'SUBMIT_REVIEW'),
    );
  }

  async withdraw(
    shopId: string,
    id: string,
    input: SellerVersion,
    actor: CatalogActor,
  ) {
    await this.get(shopId, id, actor);
    if (input.revisionVersion === undefined)
      throw new CatalogValidationError('revisionVersion is required');
    return this.workflow.withdraw(
      id,
      input.version,
      input.revisionVersion,
      this.context(shopId, actor, 'WITHDRAW_REVIEW'),
    );
  }

  private async mutate(
    shopId: string,
    id: string,
    input: SellerVersion,
    actor: CatalogActor,
    change: (product: Product) => Promise<void>,
  ) {
    const state = await this.get(shopId, id, actor);
    if (state.product.version !== input.version)
      throw new CatalogVersionConflictError();
    if (state.revision?.status === 'PENDING')
      throw new CatalogConflictError(
        'Withdraw the pending review before editing',
      );
    const product = Product.restore(state.revision?.snapshot ?? state.product);
    await change(product);
    const candidate = product.toSnapshot();
    await this.validateCategory(candidate);
    const context = this.context(shopId, actor, 'SELLER_EDIT_PRODUCT');
    if (state.product.status === 'PUBLISHED' || state.revision)
      return this.workflow.saveRevision(
        candidate,
        input.version,
        input.revisionVersion,
        context,
      );
    const saved = await this.catalog.saveProduct(
      candidate,
      input.version,
      context,
    );
    return { product: saved, revision: null };
  }

  private context(
    shopId: string,
    actor: CatalogActor,
    action: string,
  ): CatalogMutationContext {
    return { shopId, actor, action };
  }

  private async validateCategory(product: ProductSnapshot) {
    const category = await this.catalog.findCategoryById(product.categoryId);
    if (!category) throw new CatalogNotFoundError('Category not found');
    validateVariantsForCategory(category, product.variants);
  }

  private async images(
    shopId: string,
    actor: CatalogActor,
    images: ProductImageInput[],
  ) {
    if (
      !Array.isArray(images) ||
      images.some((image) => !image || typeof image.assetId !== 'string')
    )
      throw new CatalogValidationError(
        'Seller images must reference managed media assets',
      );
    const assets = await this.media.resolveForShop(
      shopId,
      actor,
      images.map((image) => image.assetId!),
    );
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return images.map((image) => {
      const asset = byId.get(image.assetId!);
      if (!asset)
        throw new CatalogValidationError('Image asset is unavailable');
      return {
        assetId: asset.id,
        url: asset.url,
        thumbnailUrl: asset.thumbnailUrl,
        alt: image.alt ?? '',
      };
    });
  }
}
