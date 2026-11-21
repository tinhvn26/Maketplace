import { createHash } from 'node:crypto';
import { CatalogValidationError } from '../../domain/errors/catalog.errors.js';
import { normalizeCatalogSearch } from '../../domain/policies/catalog-search.policy.js';
import type { CatalogBrowseQuery } from '../ports/catalog.repository.js';
import { normalizeProductQuery } from '../shared/catalog-query.policy.js';

export interface CatalogCursor {
  id: string;
  createdAt: Date;
}

function fingerprint(query: CatalogBrowseQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        q: normalizeCatalogSearch(query.q ?? ''),
        categoryId: query.categoryId ?? null,
        shopId: query.shopId ?? null,
        brandId: query.brandId ?? null,
        minPrice: query.minPrice ?? null,
        maxPrice: query.maxPrice ?? null,
        attributes: Object.entries(query.attributes ?? {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        sort: 'newest',
      }),
    )
    .digest('hex');
}

export function normalizeCatalogBrowseQuery(
  query: CatalogBrowseQuery,
): CatalogBrowseQuery {
  const { page: _page, ...normalized } = normalizeProductQuery({
    ...query,
    page: 1,
  });
  if (normalized.sort !== 'newest')
    throw new CatalogValidationError(
      'Cursor browsing currently supports newest ordering',
    );
  if (normalized.cursor !== undefined)
    decodeCatalogCursor(normalized.cursor, normalized);
  return normalized;
}

export function encodeCatalogCursor(
  cursor: CatalogCursor,
  query: CatalogBrowseQuery,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      id: cursor.id,
      createdAt: cursor.createdAt.toISOString(),
      filter: fingerprint(query),
    }),
  ).toString('base64url');
}

export function decodeCatalogCursor(
  value: string,
  query: CatalogBrowseQuery,
): CatalogCursor {
  try {
    if (
      typeof value !== 'string' ||
      value.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const data: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (typeof data !== 'object' || data === null || Array.isArray(data))
      throw new Error();
    const row = data as Record<string, unknown>;
    if (
      row.v !== 1 ||
      typeof row.id !== 'string' ||
      !row.id ||
      row.id.length > 200 ||
      typeof row.createdAt !== 'string' ||
      row.filter !== fingerprint(query)
    )
      throw new Error();
    const createdAt = new Date(row.createdAt);
    if (
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== row.createdAt
    )
      throw new Error();
    return { id: row.id, createdAt };
  } catch {
    throw new CatalogValidationError(
      'Invalid cursor or cursor filters changed',
    );
  }
}
