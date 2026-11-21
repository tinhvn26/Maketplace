import { CatalogValidationError } from '../../domain/errors/catalog.errors.js';
import type {
  AdminProductListQuery,
  ProductListQuery,
} from '../ports/catalog.repository.js';
import { normalizeVariantAttributes } from '../../domain/value-objects/variant-attributes.js';

/** Application pagination rules also protect callers outside HTTP. */
export function normalizeProductQuery<T extends ProductListQuery>(query: T): T {
  const offset = (query.page - 1) * query.limit;
  if (
    !Number.isSafeInteger(query.page) ||
    query.page < 1 ||
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset > 2_147_483_647 ||
    (query.q !== undefined &&
      (typeof query.q !== 'string' || Array.from(query.q).length > 100)) ||
    (query.categoryId !== undefined &&
      (typeof query.categoryId !== 'string' || !query.categoryId.trim()))
  ) {
    throw new CatalogValidationError('Invalid catalog search or pagination');
  }
  const status = (query as AdminProductListQuery).status;
  if (
    status !== undefined &&
    !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status)
  ) {
    throw new CatalogValidationError('Unsupported product status');
  }
  for (const amount of [query.minPrice, query.maxPrice]) {
    if (
      amount !== undefined &&
      (!Number.isInteger(amount) || amount < 0 || amount > 2_147_483_647)
    ) {
      throw new CatalogValidationError(
        'Price bounds must be whole VND amounts between 0 and 2147483647',
      );
    }
  }
  for (const id of [query.brandId, query.shopId]) {
    if (
      id !== undefined &&
      (typeof id !== 'string' || !id.trim() || id.length > 200)
    )
      throw new CatalogValidationError('Invalid catalog filter identifier');
  }
  const attributes =
    query.attributes === undefined
      ? undefined
      : normalizeVariantAttributes(query.attributes);
  if (attributes && Object.keys(attributes).length > 5)
    throw new CatalogValidationError('Filter by at most 5 variant attributes');
  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.minPrice > query.maxPrice
  ) {
    throw new CatalogValidationError(
      'Minimum price must not exceed maximum price',
    );
  }
  if (
    query.sort !== undefined &&
    !['newest', 'price-asc', 'price-desc', 'name-asc'].includes(query.sort)
  ) {
    throw new CatalogValidationError('Unsupported product sort');
  }
  return {
    ...query,
    q: query.q?.trim() || undefined,
    sort: query.sort ?? 'newest',
    ...(query.categoryId === undefined
      ? {}
      : { categoryId: query.categoryId.trim() }),
    ...(query.shopId === undefined ? {} : { shopId: query.shopId.trim() }),
    ...(query.brandId === undefined ? {} : { brandId: query.brandId.trim() }),
    ...(attributes === undefined ? {} : { attributes }),
  };
}

export function assertProductVersion(version: number): void {
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    version > 2_147_483_646
  ) {
    throw new CatalogValidationError('Version must be a nonnegative integer');
  }
}
