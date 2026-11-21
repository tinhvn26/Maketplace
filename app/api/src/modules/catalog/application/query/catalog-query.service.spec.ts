import { describe, expect, it, vi } from 'vitest';
import { Product } from '../../domain/entities/product.js';
import {
  CatalogNotFoundError,
  CatalogValidationError,
} from '../../domain/errors/catalog.errors.js';
import type {
  PublicCatalogReader,
  ProductSummary,
} from '../ports/catalog.repository.js';
import { CatalogQueryService } from './catalog-query.service.js';

function setup() {
  const now = new Date('2026-10-27T08:00:00.000Z');
  const product = Product.create({
    id: 'product',
    categoryId: 'category',
    name: 'Áo',
    slug: 'ao',
    now,
  });
  product.addVariant(
    { id: 'active', sku: 'AO-M', name: 'M', priceAmount: 150000 },
    now,
  );
  product.addVariant(
    { id: 'inactive', sku: 'AO-L', name: 'L', priceAmount: 0, isActive: false },
    now,
  );
  product.publish(now);
  const summary: ProductSummary = {
    id: 'product',
    categoryId: 'category',
    shopId: null,
    brandId: null,
    name: 'Áo',
    slug: 'ao',
    coverImage: null,
    priceFromAmount: 150000,
    currency: 'VND',
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
  const reader = {
    listCategories: vi
      .fn<PublicCatalogReader['listCategories']>()
      .mockResolvedValue([]),
    listPublishedProducts: vi
      .fn<PublicCatalogReader['listPublishedProducts']>()
      .mockResolvedValue({ items: [summary], total: 1 }),
    browsePublishedProducts: vi
      .fn<PublicCatalogReader['browsePublishedProducts']>()
      .mockResolvedValue({
        items: [summary],
        hasNext: false,
        nextCursor: null,
      }),
    findPublishedProductBySlug: vi
      .fn<PublicCatalogReader['findPublishedProductBySlug']>()
      .mockResolvedValue(product.toSnapshot()),
  } satisfies PublicCatalogReader;
  return { reader, product, service: new CatalogQueryService(reader) };
}

describe('CatalogQueryService public boundary', () => {
  it('returns a bounded summary without variants, descriptions or administrative fields', async () => {
    const { service, reader } = setup();
    const result = await service.listProducts({
      page: 1,
      limit: 20,
      q: '  Áo  ',
    });
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20, pages: 1 });
    expect(result.items[0].priceFromAmount).toBe(150000);
    expect(result.items[0]).not.toHaveProperty('variants');
    expect(result.items[0]).not.toHaveProperty('description');
    expect(result.items[0]).not.toHaveProperty('version');
    expect(result.items[0]).not.toHaveProperty('status');
    expect(reader.listPublishedProducts).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      q: 'Áo',
      sort: 'newest',
    });
  });

  it('hides category write versions from the public projection', async () => {
    const { service, reader } = setup();
    reader.listCategories.mockResolvedValue([
      {
        id: 'category',
        name: 'Áo',
        slug: 'ao',
        version: 7,
        createdAt: new Date('2026-10-28T00:00:00.000Z'),
      },
    ]);
    const categories = await service.listCategories();
    expect(categories[0]).toMatchObject({ id: 'category', name: 'Áo' });
    expect(categories[0]).not.toHaveProperty('version');
  });

  it('uses the minimum active variant as the starting price and copies nested media/options', async () => {
    const { service, reader, product } = setup();
    const snapshot = product.toSnapshot();
    snapshot.images = [{ url: 'https://example.com/cover.jpg', alt: 'Áo' }];
    snapshot.variants[0].attributes = { size: 'M' };
    reader.findPublishedProductBySlug.mockResolvedValue(snapshot);
    const result = await service.getProduct('ao');
    expect(result.priceFromAmount).toBe(150000);
    expect(result.variants).toHaveLength(1);
    result.images[0].alt = 'Changed';
    result.variants[0].attributes.size = 'L';
    expect(snapshot.images[0].alt).toBe('Áo');
    expect(snapshot.variants[0].attributes.size).toBe('M');
  });

  it('passes bounded starting-price filters and sorting to persistence', async () => {
    const { service, reader } = setup();
    await service.listProducts({
      page: 1,
      limit: 20,
      minPrice: 100000,
      maxPrice: 200000,
      sort: 'price-asc',
    });
    expect(reader.listPublishedProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        minPrice: 100000,
        maxPrice: 200000,
        sort: 'price-asc',
      }),
    );
  });

  it.each([
    { minPrice: -1 },
    { maxPrice: 2147483648 },
    { minPrice: 1.5 },
    { minPrice: 200, maxPrice: 100 },
    { sort: 'invalid' },
  ])(
    'rejects invalid price filters/sorting before storage: %j',
    async (changes) => {
      const { service, reader } = setup();
      await expect(
        service.listProducts({ page: 1, limit: 20, ...changes } as Parameters<
          CatalogQueryService['listProducts']
        >[0]),
      ).rejects.toBeInstanceOf(CatalogValidationError);
      expect(reader.listPublishedProducts).not.toHaveBeenCalled();
    },
  );

  it('normalizes a slug before lookup and reports missing products', async () => {
    const { service, reader } = setup();
    reader.findPublishedProductBySlug.mockResolvedValue(null);
    await expect(service.getProduct(' AO ')).rejects.toBeInstanceOf(
      CatalogNotFoundError,
    );
    expect(reader.findPublishedProductBySlug).toHaveBeenCalledWith('ao');
  });

  it('does not expose a draft even if an adapter violates the published lookup contract', async () => {
    const { service, reader, product } = setup();
    reader.findPublishedProductBySlug.mockResolvedValue({
      ...product.toSnapshot(),
      status: 'DRAFT',
      publishedAt: null,
    });
    await expect(service.getProduct('ao')).rejects.toBeInstanceOf(
      CatalogNotFoundError,
    );
  });

  it('rejects an unbounded query without calling persistence', async () => {
    const { service, reader } = setup();
    await expect(
      service.listProducts({ page: 1, limit: 1000 }),
    ).rejects.toBeInstanceOf(CatalogValidationError);
    expect(reader.listPublishedProducts).not.toHaveBeenCalled();
  });
});
