import { describe, expect, it, vi } from 'vitest';
import { CatalogQuoteService } from './catalog-quote.service.js';
import type {
  CatalogPurchasingReader,
  PurchasableVariant,
} from '../ports/catalog-purchasing.reader.js';
import type { CatalogQuoteRequest } from '../../contracts/catalog-pricing.api.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogValidationError,
} from '../../domain/errors/catalog.errors.js';

function fixture() {
  const records: PurchasableVariant[] = [
    {
      variantId: 'variant-one',
      productId: 'product-one',
      shopId: null,
      productName: 'First product',
      variantName: 'Small',
      sku: 'FIRST-S',
      unitPriceAmount: 100,
      currency: 'VND',
      productVersion: 3,
    },
    {
      variantId: 'variant-two',
      productId: 'product-two',
      shopId: 'shop-two',
      productName: 'Second product',
      variantName: 'Large',
      sku: 'SECOND-L',
      unitPriceAmount: 250,
      currency: 'VND',
      productVersion: 8,
    },
  ];
  const reader = {
    findPurchasableVariants: vi
      .fn<CatalogPurchasingReader['findPurchasableVariants']>()
      .mockResolvedValue(records),
  };
  const quotedAt = new Date('2026-11-03T05:00:00.000Z');
  const clock = { now: vi.fn().mockReturnValue(quotedAt) };
  return {
    service: new CatalogQuoteService(reader, clock),
    reader,
    clock,
    quotedAt,
    records,
  };
}

describe('CatalogQuoteService', () => {
  it('uses durable prices and metadata instead of caller-supplied amounts or currency', async () => {
    const { service, reader } = fixture();
    const request = {
      lines: [
        {
          variantId: 'variant-one',
          quantity: 2,
          unitPriceAmount: 1,
          currency: 'USD',
          lineTotalAmount: 2,
          productId: 'injected-product',
        },
      ],
      totalAmount: 2,
      currency: 'USD',
    };
    const result = await service.quote(request);
    expect(result).toMatchObject({
      currency: 'VND',
      totalAmount: 200,
      lines: [
        {
          variantId: 'variant-one',
          productId: 'product-one',
          quantity: 2,
          unitPriceAmount: 100,
          lineTotalAmount: 200,
          currency: 'VND',
          productVersion: 3,
        },
      ],
    });
    expect(reader.findPurchasableVariants).toHaveBeenCalledExactlyOnceWith([
      'variant-one',
    ]);
  });

  it('preserves requested order, stable identifiers and quantities even if records arrive in another order', async () => {
    const { service, records, clock, quotedAt } = fixture();
    const result = await service.quote({
      lines: [
        { variantId: 'variant-two', quantity: 3 },
        { variantId: 'variant-one', quantity: 2 },
      ],
    });
    expect(result.lines).toEqual([
      { ...records[1], quantity: 3, lineTotalAmount: 750 },
      { ...records[0], quantity: 2, lineTotalAmount: 200 },
    ]);
    expect(result.totalAmount).toBe(950);
    expect(result.currency).toBe('VND');
    expect(result.quotedAt).toEqual(quotedAt);
    expect(clock.now).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    null,
    {},
    { lines: null },
    { lines: [] },
    {
      lines: Array.from({ length: 101 }, (_, index) => ({
        variantId: `variant-${index}`,
        quantity: 1,
      })),
    },
    {
      lines: [
        { variantId: 'variant-one', quantity: 1 },
        { variantId: 'variant-one', quantity: 2 },
      ],
    },
    { lines: [null] },
    { lines: [{ variantId: '', quantity: 1 }] },
    { lines: [{ variantId: ' variant-one ', quantity: 1 }] },
    { lines: [{ variantId: 12, quantity: 1 }] },
  ])(
    'rejects invalid, oversized or duplicate selections before reading storage: %j',
    async (input) => {
      const { service, reader, clock } = fixture();
      await expect(
        service.quote(input as unknown as CatalogQuoteRequest),
      ).rejects.toBeInstanceOf(CatalogValidationError);
      expect(reader.findPurchasableVariants).not.toHaveBeenCalled();
      expect(clock.now).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, 1000, NaN, '2', null, undefined])(
    'rejects quantities outside whole units 1–999: %s',
    async (quantity) => {
      const { service, reader } = fixture();
      await expect(
        service.quote({
          lines: [{ variantId: 'variant-one', quantity: quantity as number }],
        }),
      ).rejects.toBeInstanceOf(CatalogValidationError);
      expect(reader.findPurchasableVariants).not.toHaveBeenCalled();
    },
  );

  it('accepts 100 unique variants and the maximum quantity without losing integer precision', async () => {
    const { service, reader, records } = fixture();
    const variants = Array.from({ length: 100 }, (_, index) => ({
      ...records[0],
      variantId: `variant-${index}`,
      unitPriceAmount: 2_147_483_647,
    }));
    reader.findPurchasableVariants.mockResolvedValue(variants);
    const result = await service.quote({
      lines: variants.map(({ variantId }) => ({ variantId, quantity: 999 })),
    });
    expect(result.lines).toHaveLength(100);
    expect(result.totalAmount).toBe(2_147_483_647 * 999 * 100);
    expect(Number.isSafeInteger(result.totalAmount)).toBe(true);
  });

  it('rejects a missing or unpurchasable variant instead of returning a partial quote', async () => {
    const { service, reader, records, clock } = fixture();
    reader.findPurchasableVariants.mockResolvedValue([records[0]]);
    await expect(
      service.quote({
        lines: [
          { variantId: 'variant-one', quantity: 1 },
          { variantId: 'variant-two', quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(CatalogNotFoundError);
    expect(clock.now).not.toHaveBeenCalled();
  });

  it.each([
    { expectedProductVersion: 2 },
    { expectedUnitPriceAmount: 99 },
    { expectedProductVersion: 2, expectedUnitPriceAmount: 99 },
  ])(
    'rejects stale expected prices or product revisions: %j',
    async (expectations) => {
      const { service, clock } = fixture();
      await expect(
        service.quote({
          lines: [{ variantId: 'variant-one', quantity: 1, ...expectations }],
        }),
      ).rejects.toBeInstanceOf(CatalogConflictError);
      expect(clock.now).not.toHaveBeenCalled();
    },
  );

  it('accepts matching expected values while still deriving line totals from storage', async () => {
    const { service } = fixture();
    await expect(
      service.quote({
        lines: [
          {
            variantId: 'variant-one',
            quantity: 3,
            expectedProductVersion: 3,
            expectedUnitPriceAmount: 100,
          },
        ],
      }),
    ).resolves.toMatchObject({
      totalAmount: 300,
      lines: [
        { productVersion: 3, unitPriceAmount: 100, lineTotalAmount: 300 },
      ],
    });
  });

  it.each([
    { expectedProductVersion: -1 },
    { expectedProductVersion: 1.5 },
    { expectedProductVersion: 2_147_483_648 },
    { expectedUnitPriceAmount: -1 },
    { expectedUnitPriceAmount: NaN },
    { expectedUnitPriceAmount: 2_147_483_648 },
  ])(
    'bounds expected amounts and revisions before storage access: %j',
    async (expectations) => {
      const { service, reader } = fixture();
      await expect(
        service.quote({
          lines: [{ variantId: 'variant-one', quantity: 1, ...expectations }],
        }),
      ).rejects.toBeInstanceOf(CatalogValidationError);
      expect(reader.findPurchasableVariants).not.toHaveBeenCalled();
    },
  );
});
