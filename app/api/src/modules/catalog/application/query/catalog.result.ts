import type { ProductSnapshot } from '../../domain/entities/product.js';
import type { Category } from '../../domain/entities/category.js';
import type { ProductSummary } from '../ports/catalog.repository.js';

export type PublicProductResult = Omit<
  ProductSnapshot,
  'version' | 'status'
> & {
  priceFromAmount: number | null;
};

export type PublicCategoryResult = Omit<Category, 'version'>;

export function toPublicCategory(category: Category): PublicCategoryResult {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    createdAt: new Date(category.createdAt),
    parentId: category.parentId ?? null,
    attributeDefinitions: (category.attributeDefinitions ?? []).map((item) => ({
      ...item,
      values: [...item.values],
    })),
  };
}

export function toPublicProduct(product: ProductSnapshot): PublicProductResult {
  const activeVariants = product.variants.filter((variant) => variant.isActive);
  return {
    id: product.id,
    categoryId: product.categoryId,
    shopId: product.shopId ?? null,
    brandId: product.brandId ?? null,
    name: product.name,
    slug: product.slug,
    description: product.description,
    images: product.images.map((item) => ({ ...item })),
    variants: activeVariants.map((variant) => ({
      ...variant,
      attributes: { ...variant.attributes },
      images: (variant.images ?? []).map((image) => ({ ...image })),
    })),
    priceFromAmount:
      activeVariants.length === 0
        ? null
        : Math.min(...activeVariants.map((variant) => variant.priceAmount)),
    createdAt: new Date(product.createdAt),
    updatedAt: new Date(product.updatedAt),
    publishedAt:
      product.publishedAt === null ? null : new Date(product.publishedAt),
  };
}

export function toPublicProductSummary(
  product: ProductSummary,
): ProductSummary {
  return {
    id: product.id,
    categoryId: product.categoryId,
    shopId: product.shopId ?? null,
    brandId: product.brandId ?? null,
    name: product.name,
    slug: product.slug,
    coverImage: product.coverImage ? { ...product.coverImage } : null,
    priceFromAmount: product.priceFromAmount,
    currency: 'VND',
    createdAt: new Date(product.createdAt),
    updatedAt: new Date(product.updatedAt),
    publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
  };
}
