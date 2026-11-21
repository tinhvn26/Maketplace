import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogStateError,
  CatalogValidationError,
} from '../errors/catalog.errors.js';
import {
  CATALOG_LIMITS,
  catalogDate,
  catalogDescription,
  catalogId,
  catalogName,
  catalogSku,
  catalogSlug,
} from '../policies/catalog-input.policy.js';
import { Money } from '../value-objects/money.js';
import { normalizeProductImages } from '../value-objects/product-image.js';
import type {
  ProductImage,
  ProductImageInput,
} from '../value-objects/product-image.js';
import {
  normalizeVariantAttributes,
  variantAttributeCombination,
} from '../value-objects/variant-attributes.js';

export type {
  ProductImage,
  ProductImageInput,
} from '../value-objects/product-image.js';

export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface ProductVariant {
  id: string;
  sku: string;
  name: string;
  priceAmount: number;
  currency: 'VND';
  isActive: boolean;
  attributes: Record<string, string>;
  images?: ProductImage[];
}

export interface ProductSnapshot {
  id: string;
  categoryId: string;
  shopId?: string | null;
  brandId?: string | null;
  name: string;
  slug: string;
  description: string;
  status: ProductStatus;
  version: number;
  variants: ProductVariant[];
  images: ProductImage[];
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

interface ProductDetails {
  categoryId?: string;
  brandId?: string | null;
  name?: string;
  slug?: string;
  description?: string;
  images?: ProductImageInput[];
}

interface VariantDetails {
  name?: string;
  priceAmount?: number;
  isActive?: boolean;
  attributes?: Record<string, string>;
  images?: ProductImageInput[];
}

export class Product {
  private constructor(private snapshot: ProductSnapshot) {}

  static create(input: {
    id: string;
    categoryId: string;
    shopId?: string | null;
    brandId?: string | null;
    name: string;
    slug: string;
    description?: string;
    images?: ProductImageInput[];
    now: Date;
  }): Product {
    return Product.restore({
      id: input.id,
      categoryId: input.categoryId,
      ...(input.shopId === undefined ? {} : { shopId: input.shopId }),
      ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
      name: input.name,
      slug: input.slug,
      description: input.description === undefined ? '' : input.description,
      status: 'DRAFT',
      version: 0,
      variants: [],
      images: normalizeProductImages(
        input.images === undefined ? [] : input.images,
      ),
      createdAt: input.now,
      updatedAt: input.now,
      publishedAt: null,
    });
  }

  static restore(snapshot: ProductSnapshot): Product {
    return new Product(Product.validate(snapshot));
  }

  toSnapshot(): ProductSnapshot {
    return {
      ...this.snapshot,
      variants: this.snapshot.variants.map((variant) => ({
        ...variant,
        attributes: { ...variant.attributes },
        ...(variant.images === undefined
          ? {}
          : { images: variant.images.map((image) => ({ ...image })) }),
      })),
      images: this.snapshot.images.map((image) => ({ ...image })),
      createdAt: new Date(this.snapshot.createdAt.getTime()),
      updatedAt: new Date(this.snapshot.updatedAt.getTime()),
      publishedAt:
        this.snapshot.publishedAt === null
          ? null
          : new Date(this.snapshot.publishedAt.getTime()),
    };
  }

  updateDetails(changes: ProductDetails, now: Date): void {
    this.assertMutable();
    if (
      typeof changes !== 'object' ||
      changes === null ||
      (changes.categoryId === undefined &&
        changes.brandId === undefined &&
        changes.name === undefined &&
        changes.slug === undefined &&
        changes.description === undefined &&
        changes.images === undefined)
    ) {
      throw new CatalogValidationError(
        'Provide at least one product detail to update',
      );
    }
    this.commit(
      {
        ...(changes.brandId === undefined ? {} : { brandId: changes.brandId }),
        categoryId:
          changes.categoryId === undefined
            ? this.snapshot.categoryId
            : changes.categoryId,
        name: changes.name === undefined ? this.snapshot.name : changes.name,
        slug: changes.slug === undefined ? this.snapshot.slug : changes.slug,
        description:
          changes.description === undefined
            ? this.snapshot.description
            : changes.description,
        images:
          changes.images === undefined
            ? this.snapshot.images
            : normalizeProductImages(changes.images),
      },
      now,
    );
  }

  addVariant(
    input: {
      id: string;
      sku: string;
      name: string;
      priceAmount: number;
      isActive?: boolean;
      attributes?: Record<string, string>;
      images?: ProductImageInput[];
    },
    now: Date,
  ): void {
    this.assertMutable();
    this.commit(
      {
        variants: [
          ...this.snapshot.variants,
          {
            id: input.id,
            sku: input.sku,
            name: input.name,
            priceAmount: input.priceAmount,
            currency: 'VND',
            isActive: input.isActive === undefined ? true : input.isActive,
            attributes: input.attributes === undefined ? {} : input.attributes,
            ...(input.images === undefined
              ? {}
              : { images: normalizeProductImages(input.images) }),
          },
        ],
      },
      now,
    );
  }

  updateVariant(variantId: string, changes: VariantDetails, now: Date): void {
    this.assertMutable();
    if (!this.snapshot.variants.some((variant) => variant.id === variantId)) {
      throw new CatalogNotFoundError('Product variant not found');
    }
    if (
      typeof changes !== 'object' ||
      changes === null ||
      (changes.name === undefined &&
        changes.priceAmount === undefined &&
        changes.isActive === undefined &&
        changes.attributes === undefined &&
        changes.images === undefined)
    ) {
      throw new CatalogValidationError(
        'Provide at least one variant detail to update',
      );
    }
    this.commit(
      {
        variants: this.snapshot.variants.map((variant) =>
          variant.id === variantId
            ? {
                ...variant,
                name: changes.name === undefined ? variant.name : changes.name,
                priceAmount:
                  changes.priceAmount === undefined
                    ? variant.priceAmount
                    : changes.priceAmount,
                isActive:
                  changes.isActive === undefined
                    ? variant.isActive
                    : changes.isActive,
                attributes:
                  changes.attributes === undefined
                    ? variant.attributes
                    : changes.attributes,
                ...(changes.images === undefined
                  ? {}
                  : { images: normalizeProductImages(changes.images) }),
              }
            : variant,
        ),
      },
      now,
    );
  }

  publish(now: Date): void {
    if (this.snapshot.status !== 'DRAFT') {
      throw new CatalogStateError('Only draft products can be published');
    }
    this.commit({ status: 'PUBLISHED', publishedAt: now }, now);
  }

  archive(now: Date): void {
    this.assertMutable();
    this.commit({ status: 'ARCHIVED' }, now);
  }

  unpublish(now: Date): void {
    if (this.snapshot.status !== 'PUBLISHED') {
      throw new CatalogStateError('Only published products can be unpublished');
    }
    this.commit({ status: 'DRAFT', publishedAt: null }, now);
  }

  restoreToDraft(now: Date): void {
    if (this.snapshot.status !== 'ARCHIVED') {
      throw new CatalogStateError(
        'Only archived products can be restored to draft',
      );
    }
    this.commit({ status: 'DRAFT', publishedAt: null }, now);
  }

  private assertMutable(): void {
    if (this.snapshot.status === 'ARCHIVED') {
      throw new CatalogStateError('Archived products cannot be changed');
    }
  }

  private commit(changes: Partial<ProductSnapshot>, now: Date): void {
    const candidate = Product.validate({
      ...this.snapshot,
      ...changes,
      updatedAt: catalogDate(now),
    });
    this.snapshot = candidate;
  }

  private static validate(snapshot: ProductSnapshot): ProductSnapshot {
    if (typeof snapshot !== 'object' || snapshot === null) {
      throw new CatalogValidationError('A product snapshot is required');
    }
    if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(snapshot.status)) {
      throw new CatalogValidationError('Unsupported product status');
    }
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 0) {
      throw new CatalogValidationError(
        'Product version must be a nonnegative integer',
      );
    }
    if (
      !Array.isArray(snapshot.variants) ||
      snapshot.variants.length > CATALOG_LIMITS.variants
    ) {
      throw new CatalogValidationError(
        'Products may contain at most 50 variants',
      );
    }
    const ids = new Set<string>();
    const skus = new Set<string>();
    const combinations = new Set<string>();
    const variants = snapshot.variants.map((variant) => {
      if (typeof variant !== 'object' || variant === null) {
        throw new CatalogValidationError('A variant must be an object');
      }
      const id = catalogId(variant.id);
      const sku = catalogSku(variant.sku);
      if (ids.has(id) || skus.has(sku)) {
        throw new CatalogConflictError(
          'Variant identifiers and SKUs must be unique',
        );
      }
      ids.add(id);
      skus.add(sku);
      if (variant.currency !== 'VND') {
        throw new CatalogValidationError('Only VND prices are supported');
      }
      if (typeof variant.isActive !== 'boolean') {
        throw new CatalogValidationError(
          'Variant active flag must be a boolean',
        );
      }
      const attributes = normalizeVariantAttributes(
        variant.attributes === undefined ? {} : variant.attributes,
      );
      const combination = variantAttributeCombination(attributes);
      if (combination !== null) {
        if (combinations.has(combination)) {
          throw new CatalogConflictError(
            'Variant attribute combinations must be unique within a product',
          );
        }
        combinations.add(combination);
      }
      return {
        id,
        sku,
        name: catalogName(variant.name, CATALOG_LIMITS.variantName),
        priceAmount: Money.vnd(variant.priceAmount).amount,
        currency: 'VND' as const,
        isActive: variant.isActive,
        attributes,
        ...(variant.images === undefined
          ? {}
          : { images: normalizeProductImages(variant.images) }),
      };
    });
    if (snapshot.status === 'PUBLISHED') {
      const active = variants.filter((variant) => variant.isActive);
      if (
        active.length === 0 ||
        active.some((variant) => variant.priceAmount <= 0)
      ) {
        throw new CatalogStateError(
          'Published products require at least one active variant and positive prices for every active variant',
        );
      }
      if (snapshot.publishedAt === null) {
        throw new CatalogStateError(
          'Published products require a publication timestamp',
        );
      }
    }
    if (snapshot.status === 'DRAFT' && snapshot.publishedAt !== null) {
      throw new CatalogStateError(
        'Draft products cannot have a publication timestamp',
      );
    }
    return {
      id: catalogId(snapshot.id),
      categoryId: catalogId(snapshot.categoryId),
      ...(snapshot.shopId === undefined
        ? {}
        : {
            shopId:
              snapshot.shopId === null ? null : catalogId(snapshot.shopId),
          }),
      ...(snapshot.brandId === undefined
        ? {}
        : {
            brandId:
              snapshot.brandId === null ? null : catalogId(snapshot.brandId),
          }),
      name: catalogName(snapshot.name, CATALOG_LIMITS.productName),
      slug: catalogSlug(snapshot.slug),
      description: catalogDescription(snapshot.description),
      status: snapshot.status,
      version: snapshot.version,
      variants,
      images: normalizeProductImages(
        snapshot.images === undefined ? [] : snapshot.images,
      ),
      createdAt: catalogDate(snapshot.createdAt),
      updatedAt: catalogDate(snapshot.updatedAt),
      publishedAt:
        snapshot.publishedAt === null
          ? null
          : catalogDate(snapshot.publishedAt),
    };
  }
}
