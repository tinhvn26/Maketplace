import { describe, expect, it } from 'vitest';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogStateError,
  CatalogValidationError,
  CatalogVersionConflictError,
} from '../errors/catalog.errors.js';
import { Product, type ProductSnapshot } from './product.js';

const createdAt = new Date('2026-10-27T00:00:00.000Z');
const changedAt = new Date('2026-10-27T01:00:00.000Z');
const input = {
  id: 'product-one',
  categoryId: 'category-one',
  name: '  Cà phê  ',
  slug: ' COFFEE ',
  now: createdAt,
};
const variant = {
  id: 'variant-one',
  sku: ' coffee-250g ',
  name: ' Gói 250g ',
  priceAmount: 95_000,
};

function productWithVariant(): Product {
  const product = Product.create(input);
  product.addVariant(variant, createdAt);
  return product;
}

describe('Product aggregate', () => {
  it('creates a normalized draft without sellable variants and leaves version assignment to persistence', () => {
    expect(Product.create(input).toSnapshot()).toEqual({
      id: 'product-one',
      categoryId: 'category-one',
      name: 'Cà phê',
      slug: 'coffee',
      description: '',
      status: 'DRAFT',
      version: 0,
      variants: [],
      images: [],
      createdAt,
      updatedAt: createdAt,
      publishedAt: null,
    });
  });

  it('publishes only once the draft has an active variant with a positive price', () => {
    const product = Product.create(input);
    const empty = product.toSnapshot();
    expect(() => product.publish(changedAt)).toThrow(CatalogStateError);
    expect(product.toSnapshot()).toEqual(empty);
    product.addVariant({ ...variant, priceAmount: 0 }, createdAt);
    const zeroPrice = product.toSnapshot();
    expect(() => product.publish(changedAt)).toThrow(CatalogStateError);
    expect(product.toSnapshot()).toEqual(zeroPrice);
    product.updateVariant(variant.id, { priceAmount: 95_000 }, changedAt);
    product.publish(changedAt);
    expect(product.toSnapshot()).toMatchObject({
      status: 'PUBLISHED',
      version: 0,
      createdAt,
      updatedAt: changedAt,
      publishedAt: changedAt,
    });
    expect(() => product.publish(changedAt)).toThrow(CatalogStateError);
  });

  it('does not publish a draft whose variants are all inactive', () => {
    const product = Product.create(input);
    product.addVariant({ ...variant, isActive: false }, createdAt);
    expect(() => product.publish(changedAt)).toThrow(CatalogStateError);
    expect(product.toSnapshot().status).toBe('DRAFT');
  });

  it('protects publication invariants on every variant mutation without partially changing the aggregate', () => {
    const product = productWithVariant();
    product.publish(createdAt);
    product.addVariant(
      {
        ...variant,
        id: 'variant-two',
        sku: 'coffee-500g',
        priceAmount: 0,
        isActive: false,
      },
      createdAt,
    );
    const published = product.toSnapshot();
    for (const changes of [{ isActive: false }, { priceAmount: 0 }]) {
      expect(() =>
        product.updateVariant(variant.id, changes, changedAt),
      ).toThrow(CatalogStateError);
      expect(product.toSnapshot()).toEqual(published);
    }
    expect(() =>
      product.updateVariant('variant-two', { isActive: true }, changedAt),
    ).toThrow(CatalogStateError);
    expect(product.toSnapshot()).toEqual(published);
    expect(() =>
      product.addVariant(
        { ...variant, id: 'variant-three', sku: 'coffee-1kg', priceAmount: 0 },
        changedAt,
      ),
    ).toThrow(CatalogStateError);
    expect(product.toSnapshot()).toEqual(published);
    product.updateVariant(
      'variant-two',
      { isActive: true, priceAmount: 180_000 },
      changedAt,
    );
    product.updateVariant(variant.id, { isActive: false }, changedAt);
    expect(
      product
        .toSnapshot()
        .variants.map(({ id, isActive }) => ({ id, isActive })),
    ).toEqual([
      { id: 'variant-one', isActive: false },
      { id: 'variant-two', isActive: true },
    ]);
  });

  it('rejects duplicate normalized SKUs and identities without adding a variant', () => {
    const product = productWithVariant();
    const before = product.toSnapshot();
    expect(() =>
      product.addVariant(
        { ...variant, id: 'another-id', sku: 'COFFEE-250G' },
        changedAt,
      ),
    ).toThrow(CatalogConflictError);
    expect(() =>
      product.addVariant({ ...variant, sku: 'different-sku' }, changedAt),
    ).toThrow(CatalogConflictError);
    expect(product.toSnapshot()).toEqual(before);
    expect(product.toSnapshot().variants[0]).toMatchObject({
      id: variant.id,
      sku: 'COFFEE-250G',
      currency: 'VND',
      isActive: true,
    });
  });

  it('leaves details, variant values and timestamps unchanged when validation fails', () => {
    const product = productWithVariant();
    const before = product.toSnapshot();
    expect(() =>
      product.updateDetails(
        { name: 'Would change', slug: 'invalid slug' },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(product.toSnapshot()).toEqual(before);
    expect(() =>
      product.updateVariant(
        variant.id,
        { name: 'Would change', priceAmount: -1 },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(product.toSnapshot()).toEqual(before);
    expect(() =>
      product.updateVariant('unknown', { name: 'Missing' }, changedAt),
    ).toThrow(CatalogNotFoundError);
    expect(product.toSnapshot()).toEqual(before);
  });

  it('ignores smuggled state and identity fields while applying only declared changes', () => {
    const product = productWithVariant();
    const detailChanges = {
      name: 'Changed',
      id: 'hijacked',
      status: 'PUBLISHED',
      version: 99,
    };
    product.updateDetails(detailChanges, changedAt);
    const variantChanges = {
      name: 'Changed variant',
      id: 'hijacked-variant',
      sku: 'HIJACKED',
    };
    product.updateVariant(variant.id, variantChanges, changedAt);
    expect(product.toSnapshot()).toMatchObject({
      id: input.id,
      name: 'Changed',
      status: 'DRAFT',
      version: 0,
    });
    expect(product.toSnapshot().variants[0]).toMatchObject({
      id: variant.id,
      sku: 'COFFEE-250G',
      name: 'Changed variant',
    });
  });

  it('rejects empty known-field updates and runtime null values without committing them', () => {
    const product = productWithVariant();
    const before = product.toSnapshot();
    expect(() => product.updateDetails({}, changedAt)).toThrow(
      CatalogValidationError,
    );
    expect(() => product.updateDetails({ name: undefined }, changedAt)).toThrow(
      CatalogValidationError,
    );
    expect(() => product.updateVariant(variant.id, {}, changedAt)).toThrow(
      CatalogValidationError,
    );
    expect(() =>
      product.updateDetails(
        { name: null } as unknown as { name: string },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(() =>
      product.updateVariant(
        variant.id,
        { priceAmount: null } as unknown as { priceAmount: number },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(product.toSnapshot()).toEqual(before);
  });

  it.each(['DRAFT', 'PUBLISHED'] as const)(
    'blocks ordinary mutations of archived products when archived from %s',
    (status) => {
      const product = productWithVariant();
      if (status === 'PUBLISHED') product.publish(createdAt);
      product.archive(changedAt);
      const archived = product.toSnapshot();
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.publishedAt).toEqual(
        status === 'PUBLISHED' ? createdAt : null,
      );
      const attempts = [
        () => product.archive(changedAt),
        () => product.publish(changedAt),
        () => product.updateDetails({ name: 'Changed' }, changedAt),
        () =>
          product.addVariant(
            { ...variant, id: 'variant-two', sku: 'new' },
            changedAt,
          ),
        () => product.updateVariant(variant.id, { name: 'Changed' }, changedAt),
      ];
      for (const attempt of attempts) {
        expect(attempt).toThrow(CatalogStateError);
        expect(product.toSnapshot()).toEqual(archived);
      }
    },
  );

  it('defensively copies restored snapshots and every snapshot it exposes', () => {
    const original = productWithVariant();
    original.publish(createdAt);
    const persisted = { ...original.toSnapshot(), version: 17 };
    const product = Product.restore(persisted);
    const before = product.toSnapshot();
    persisted.variants[0].priceAmount = 1;
    persisted.variants.push({ ...persisted.variants[0], id: 'injected' });
    persisted.createdAt.setTime(0);
    persisted.updatedAt.setTime(0);
    persisted.publishedAt!.setTime(0);
    const returned = product.toSnapshot();
    returned.variants[0].sku = 'INJECTED';
    returned.variants.length = 0;
    returned.createdAt.setTime(0);
    returned.updatedAt.setTime(0);
    returned.publishedAt!.setTime(0);
    expect(product.toSnapshot()).toEqual(before);
    product.updateDetails({ name: 'Changed' }, changedAt);
    product.updateVariant(variant.id, { priceAmount: 100_000 }, changedAt);
    product.archive(changedAt);
    expect(product.toSnapshot().version).toBe(17);
  });

  it('permits 50 variants and rejects a fifty-first without changing the product', () => {
    const product = Product.create(input);
    for (let index = 0; index < 50; index++) {
      product.addVariant(
        { ...variant, id: `variant-${index}`, sku: `SKU-${index}` },
        createdAt,
      );
    }
    const before = product.toSnapshot();
    expect(before.variants).toHaveLength(50);
    expect(() =>
      product.addVariant(
        { ...variant, id: 'variant-51', sku: 'SKU-51' },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(product.toSnapshot()).toEqual(before);
  });

  it('enforces Unicode name and description limits and the ASCII slug boundary', () => {
    const product = Product.create({
      ...input,
      name: '🙂'.repeat(160),
      slug: 'a'.repeat(180),
      description: '🙂'.repeat(5000),
    });
    product.addVariant(
      { ...variant, name: '🙂'.repeat(120), sku: `A${'_'.repeat(63)}` },
      createdAt,
    );
    const before = product.toSnapshot();
    for (const changes of [
      { name: '🙂'.repeat(161) },
      { description: '🙂'.repeat(5001) },
      { slug: 'a'.repeat(181) },
      { categoryId: '' },
    ])
      expect(() => product.updateDetails(changes, changedAt)).toThrow(
        CatalogValidationError,
      );
    expect(() =>
      product.updateVariant(variant.id, { name: '🙂'.repeat(121) }, changedAt),
    ).toThrow(CatalogValidationError);
    expect(() =>
      product.addVariant(
        { ...variant, id: 'invalid-sku', sku: `A${'_'.repeat(64)}` },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(product.toSnapshot()).toEqual(before);
  });

  it('rejects invalid persisted currencies, versions and publication state', () => {
    const snapshot = productWithVariant().toSnapshot();
    expect(() => Product.restore({ ...snapshot, version: -1 })).toThrow(
      CatalogValidationError,
    );
    expect(() => Product.restore({ ...snapshot, status: 'PUBLISHED' })).toThrow(
      CatalogStateError,
    );
    expect(() =>
      Product.restore({
        ...snapshot,
        variants: [{ ...snapshot.variants[0], currency: 'USD' }],
      } as unknown as ProductSnapshot),
    ).toThrow(CatalogValidationError);
  });

  it('retains conflict inheritance and specific error codes for HTTP-independent classification', () => {
    const state = new CatalogStateError();
    const version = new CatalogVersionConflictError();
    expect(state).toBeInstanceOf(CatalogConflictError);
    expect(version).toBeInstanceOf(CatalogConflictError);
    expect(state.code).toBe('CATALOG_INVALID_STATE');
    expect(version.code).toBe('CATALOG_VERSION_CONFLICT');
  });

  it('restores legacy snapshots without images or attributes without adding new publication requirements', () => {
    const original = productWithVariant();
    original.publish(createdAt);
    const { images: _images, ...snapshot } = original.toSnapshot();
    const legacy = {
      ...snapshot,
      variants: snapshot.variants.map(
        ({ attributes: _attributes, ...details }) => details,
      ),
    };
    const restored = Product.restore(legacy as ProductSnapshot).toSnapshot();
    expect(restored.images).toEqual([]);
    expect(restored.variants[0].attributes).toEqual({});
    expect(restored.status).toBe('PUBLISHED');
  });

  it('copies nested images and variant attributes at creation, restore, mutation and snapshot boundaries', () => {
    const images = [{ url: 'https://example.com/front.png', alt: 'Front' }];
    const attributes = { color: 'Black' };
    const product = Product.create({ ...input, images });
    product.addVariant({ ...variant, attributes }, createdAt);
    images[0].alt = 'Injected';
    attributes.color = 'Injected';
    const snapshot = product.toSnapshot();
    expect(snapshot.images[0].alt).toBe('Front');
    expect(snapshot.variants[0].attributes.color).toBe('Black');
    const restored = Product.restore(snapshot);
    const before = restored.toSnapshot();
    snapshot.images[0].url = 'https://example.com/injected.png';
    snapshot.variants[0].attributes.color = 'Injected';
    const exposed = restored.toSnapshot();
    exposed.images[0].alt = 'Injected';
    exposed.variants[0].attributes.color = 'Injected';
    expect(restored.toSnapshot()).toEqual(before);
    const replacement = [{ url: 'https://example.com/back.png' }];
    const replacementAttributes = { size: 'M' };
    restored.updateDetails({ images: replacement }, changedAt);
    restored.updateVariant(
      variant.id,
      { attributes: replacementAttributes },
      changedAt,
    );
    replacement[0].url = 'https://example.com/injected.png';
    replacementAttributes.size = 'Injected';
    expect(restored.toSnapshot().images).toEqual([
      { url: 'https://example.com/back.png', alt: '' },
    ]);
    expect(restored.toSnapshot().variants[0].attributes).toEqual({ size: 'M' });
  });

  it('supports clearing images and attributes with explicit empty collections', () => {
    const product = Product.create({
      ...input,
      images: [{ url: 'https://example.com/front.png' }],
    });
    product.addVariant(
      { ...variant, attributes: { color: 'Black' } },
      createdAt,
    );
    product.updateDetails({ images: [] }, changedAt);
    product.updateVariant(variant.id, { attributes: {} }, changedAt);
    expect(product.toSnapshot().images).toEqual([]);
    expect(product.toSnapshot().variants[0].attributes).toEqual({});
  });

  it('reserves every nonempty option combination, including inactive variants, while allowing legacy empty maps', () => {
    const product = productWithVariant();
    product.addVariant(
      { ...variant, id: 'variant-two', sku: 'COFFEE-500G' },
      createdAt,
    );
    product.updateVariant(
      variant.id,
      { attributes: { Size: ' M ', Color: 'BLACK' }, isActive: false },
      changedAt,
    );
    const before = product.toSnapshot();
    expect(() =>
      product.addVariant(
        {
          ...variant,
          id: 'variant-three',
          sku: 'COFFEE-1KG',
          attributes: { color: 'black', size: 'm' },
        },
        changedAt,
      ),
    ).toThrow(CatalogConflictError);
    expect(() =>
      product.updateVariant(
        'variant-two',
        { attributes: { color: 'Black', size: 'M' }, name: 'Would change' },
        changedAt,
      ),
    ).toThrow(CatalogConflictError);
    expect(product.toSnapshot()).toEqual(before);
  });

  it('rejects invalid media and attributes before committing other fields or timestamps', () => {
    const product = productWithVariant();
    const before = product.toSnapshot();
    expect(() =>
      product.updateDetails(
        { name: 'Would change', images: [{ url: 'javascript:alert(1)' }] },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(() =>
      product.updateVariant(
        variant.id,
        { name: 'Would change', attributes: { color: ' ' } },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(() =>
      product.updateDetails(
        { images: null } as unknown as { images: [] },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(() =>
      product.updateVariant(
        variant.id,
        { attributes: null } as unknown as { attributes: {} },
        changedAt,
      ),
    ).toThrow(CatalogValidationError);
    expect(product.toSnapshot()).toEqual(before);
  });

  it('unpublishes to an editable draft, clears publication time and rechecks invariants on republish', () => {
    const product = Product.restore({
      ...productWithVariant().toSnapshot(),
      version: 6,
    });
    product.publish(createdAt);
    product.unpublish(changedAt);
    expect(product.toSnapshot()).toMatchObject({
      status: 'DRAFT',
      version: 6,
      publishedAt: null,
      updatedAt: changedAt,
    });
    product.updateVariant(variant.id, { priceAmount: 0 }, changedAt);
    expect(() => product.publish(changedAt)).toThrow(CatalogStateError);
    product.updateVariant(variant.id, { priceAmount: 110_000 }, changedAt);
    product.publish(changedAt);
    expect(product.toSnapshot()).toMatchObject({
      status: 'PUBLISHED',
      publishedAt: changedAt,
      version: 6,
    });
    expect(product.toSnapshot().variants[0]).toMatchObject({
      id: variant.id,
      sku: 'COFFEE-250G',
    });
  });

  it.each(['DRAFT', 'PUBLISHED'] as const)(
    'restores a product archived from %s to draft without resurrecting public visibility',
    (status) => {
      const product = productWithVariant();
      if (status === 'PUBLISHED') product.publish(createdAt);
      product.archive(createdAt);
      product.restoreToDraft(changedAt);
      expect(product.toSnapshot()).toMatchObject({
        status: 'DRAFT',
        publishedAt: null,
        updatedAt: changedAt,
        version: 0,
      });
      product.updateDetails({ name: 'Restored name' }, changedAt);
      expect(product.toSnapshot().name).toBe('Restored name');
      expect(product.toSnapshot().variants[0]).toMatchObject({
        id: variant.id,
        sku: 'COFFEE-250G',
      });
    },
  );

  it('rejects unpublish and restore transitions from the wrong state without changing the snapshot', () => {
    const product = productWithVariant();
    const draft = product.toSnapshot();
    expect(() => product.unpublish(changedAt)).toThrow(CatalogStateError);
    expect(() => product.restoreToDraft(changedAt)).toThrow(CatalogStateError);
    expect(product.toSnapshot()).toEqual(draft);
    product.publish(createdAt);
    const published = product.toSnapshot();
    expect(() => product.restoreToDraft(changedAt)).toThrow(CatalogStateError);
    expect(product.toSnapshot()).toEqual(published);
    product.archive(createdAt);
    const archived = product.toSnapshot();
    expect(() => product.unpublish(changedAt)).toThrow(CatalogStateError);
    expect(product.toSnapshot()).toEqual(archived);
  });
});
