import { setTimeout as delay } from 'node:timers/promises';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import type { Category } from '../../domain/entities/category.js';
import type { ProductSnapshot } from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
} from '../../domain/errors/catalog.errors.js';
import { normalizeCategoryAttributeDefinitions } from '../../domain/policies/category-attributes.policy.js';

/** Row mappers and write retry shared by the catalog Prisma repositories. */

export type PersistedProduct = Prisma.CatalogProductGetPayload<{
  include: { variants: true };
}>;
export type CategoryRow = Prisma.CatalogCategoryGetPayload<object>;

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version,
    createdAt: row.createdAt,
    parentId: row.parentId,
    attributeDefinitions: normalizeCategoryAttributeDefinitions(
      row.attributeDefinitions,
    ),
  };
}
export function toProductSnapshot(row: PersistedProduct): ProductSnapshot {
  if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(row.status))
    throw new Error('Unsupported persisted catalog product status');
  return {
    id: row.id,
    categoryId: row.categoryId,
    shopId: row.shopId,
    brandId: row.brandId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    images: persistedImages(row.images),
    status: row.status as ProductSnapshot['status'],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    variants: row.variants.map((variant) => {
      if (variant.currency !== 'VND')
        throw new Error('Unsupported persisted catalog variant currency');
      return {
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        priceAmount: variant.priceAmount,
        currency: 'VND',
        isActive: variant.isActive,
        attributes: persistedAttributes(variant.attributes),
        images: persistedImages(variant.images),
      };
    }),
  };
}
export function persistedImages(
  value: Prisma.JsonValue,
): ProductSnapshot['images'] {
  if (!Array.isArray(value))
    throw new Error('Unsupported persisted product images');
  return value.map((image) => {
    if (
      typeof image !== 'object' ||
      image === null ||
      Array.isArray(image) ||
      typeof image.url !== 'string' ||
      typeof image.alt !== 'string' ||
      (image.assetId !== undefined && typeof image.assetId !== 'string') ||
      (image.thumbnailUrl !== undefined &&
        typeof image.thumbnailUrl !== 'string')
    )
      throw new Error('Unsupported persisted product image');
    return {
      url: image.url,
      alt: image.alt,
      ...(image.assetId === undefined ? {} : { assetId: image.assetId }),
      ...(image.thumbnailUrl === undefined
        ? {}
        : { thumbnailUrl: image.thumbnailUrl }),
    };
  });
}
export function persistedAttributes(
  value: Prisma.JsonValue,
): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Unsupported persisted variant attributes');
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== 'string')
        throw new Error('Unsupported persisted variant attribute');
      return [key, item];
    }),
  );
}
/** Retries SQLite contention and maps constraint failures to catalog errors. */
export async function retryCatalogWrite<T>(
  operation: () => Promise<T>,
  deleting = false,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (isSqliteContention(error)) {
        if (attempt < 2) {
          await delay(0);
          continue;
        }
        throw new CatalogConflictError(
          'Catalog storage is busy; retry the operation',
        );
      }
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === 'P2002')
          throw new CatalogConflictError(
            'A catalog slug or SKU is already in use',
          );
        if (deleting && error.code === 'P2003')
          throw new CatalogConflictError('Taxonomy resource is still in use');
        if (error.code === 'P2003' || error.code === 'P2025')
          throw new CatalogNotFoundError('Catalog resource not found');
      }
      throw error;
    }
  }
}
function isSqliteContention(error: unknown): boolean {
  const object = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const cause = object(
    object(object(object(error)?.meta)?.driverAdapterError)?.cause,
  );
  return (
    cause?.originalCode === 'SQLITE_BUSY' ||
    cause?.originalCode === 'SQLITE_LOCKED'
  );
}
