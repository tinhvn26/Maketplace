import { describe, expect, it } from 'vitest';
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  normalizeCatalogBrowseQuery,
} from './catalog-cursor.js';
import { normalizeProductQuery } from '../shared/catalog-query.policy.js';
import { CatalogValidationError } from '../../domain/errors/catalog.errors.js';

describe('Catalog cursor query contract', () => {
  const query = {
    limit: 20,
    q: 'Cà phê',
    categoryId: 'coffee',
    sort: 'newest' as const,
    attributes: { size: 'M', color: 'red' },
  };
  const position = {
    id: 'product',
    createdAt: new Date('2026-11-03T00:00:00.000Z'),
  };
  it('binds the compound position to canonical filters without binding page size', () => {
    const cursor = encodeCatalogCursor(position, query);
    expect(
      decodeCatalogCursor(cursor, {
        ...query,
        limit: 30,
        q: 'CA PHE',
        attributes: { color: 'red', size: 'M' },
      }),
    ).toEqual(position);
    expect(() =>
      decodeCatalogCursor(cursor, { ...query, categoryId: 'other' }),
    ).toThrow(CatalogValidationError);
    expect(() =>
      normalizeCatalogBrowseQuery({ ...query, sort: 'price-asc' }),
    ).toThrow(CatalogValidationError);
  });
  it.each([
    'invalid',
    '!',
    'a'.repeat(2049),
    Buffer.from(
      JSON.stringify({ id: 'product', createdAt: 'invalid' }),
    ).toString('base64url'),
  ])('rejects malformed cursor %j', (cursor) => {
    expect(() => normalizeCatalogBrowseQuery({ ...query, cursor })).toThrow(
      CatalogValidationError,
    );
  });
  it('bounds and normalizes variant filters before persistence', () => {
    expect(
      normalizeProductQuery({
        page: 1,
        limit: 20,
        attributes: { ' Size ': ' M ' },
      }).attributes,
    ).toEqual({ size: 'M' });
    expect(() =>
      normalizeProductQuery({
        page: 1,
        limit: 20,
        attributes: Object.fromEntries(
          Array.from({ length: 6 }, (_, index) => ['key' + index, 'value']),
        ),
      }),
    ).toThrow(CatalogValidationError);
  });
});
