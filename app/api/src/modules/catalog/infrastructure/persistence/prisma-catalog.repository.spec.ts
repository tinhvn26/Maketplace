import 'reflect-metadata';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { Category } from '../../domain/entities/category.js';
import type {
  ProductSnapshot,
  ProductVariant,
} from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import { PrismaCatalogRepository } from './prisma-catalog.repository.js';

describe('PrismaCatalogRepository with SQLite', () => {
  let prisma: PrismaService;
  let repository: PrismaCatalogRepository;
  let directory: string;
  let category: Category;
  let migratedLegacy: {
    categoryVersion: number;
    images: ProductSnapshot['images'];
    attributes: Record<string, string>;
    productVersion: number;
    prices: Array<number | null>;
    search: string;
  };
  const now = new Date('2026-10-27T03:00:00.000Z');

  function variant(
    id: string,
    overrides: Partial<ProductVariant> = {},
  ): ProductVariant {
    return {
      id,
      sku: id.toUpperCase(),
      name: id,
      priceAmount: 25_000,
      currency: 'VND',
      isActive: true,
      attributes: {},
      images: [],
      ...overrides,
    };
  }

  function product(
    id: string,
    overrides: Partial<ProductSnapshot> = {},
  ): ProductSnapshot {
    return {
      id,
      categoryId: category.id,
      shopId: null,
      brandId: null,
      name: id,
      slug: id,
      description: '',
      images: [],
      status: 'DRAFT',
      version: 0,
      variants: [],
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      ...overrides,
    };
  }

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), 'marketplate-catalog-persistence-'),
    );
    const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', databaseUrl);
    const connection = await new PrismaBetterSqlite3({
      url: databaseUrl,
    }).connect();
    try {
      const migrations = new URL(
        '../../../../../prisma/migrations/',
        import.meta.url,
      );
      for (const entry of (await readdir(migrations, { withFileTypes: true }))
        .filter((item) => item.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.name === '20261028000000_complete_catalog') {
          await connection.executeScript(`
            INSERT INTO "CatalogCategory" ("id", "name", "slug")
            VALUES ('legacy-category', 'Legacy', 'legacy');
            INSERT INTO "CatalogProduct"
              ("id", "categoryId", "name", "slug", "status", "version", "updatedAt", "publishedAt")
            VALUES
              ('legacy-active', 'legacy-category', 'Cà phê ĐẶC BIỆT', 'legacy-active', 'PUBLISHED', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
              ('legacy-inactive', 'legacy-category', 'Legacy inactive', 'legacy-inactive', 'DRAFT', 3, CURRENT_TIMESTAMP, NULL);
            INSERT INTO "CatalogVariant"
              ("id", "productId", "sku", "name", "priceAmount", "isActive")
            VALUES
              ('legacy-low', 'legacy-active', 'LEGACY-LOW', 'Low', 150, true),
              ('legacy-high', 'legacy-active', 'LEGACY-HIGH', 'High', 300, true),
              ('legacy-zero', 'legacy-active', 'LEGACY-ZERO', 'Inactive zero', 0, false),
              ('legacy-only-inactive', 'legacy-inactive', 'LEGACY-INACTIVE', 'Inactive', 100, false);
          `);
        }
        await connection.executeScript(
          await readFile(
            new URL(`${entry.name}/migration.sql`, migrations),
            'utf8',
          ),
        );
      }
    } finally {
      await connection.dispose();
    }
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaCatalogRepository(prisma);
    const legacyProduct = await repository.findProductById('legacy-active');
    const legacyCategory = await repository.findCategoryById('legacy-category');
    const legacyPrices = await prisma.catalogProduct.findMany({
      where: { id: { in: ['legacy-active', 'legacy-inactive'] } },
      orderBy: { id: 'asc' },
      select: { minPriceAmount: true },
    });
    migratedLegacy = {
      categoryVersion: legacyCategory!.version,
      images: legacyProduct!.images,
      attributes: legacyProduct!.variants[0].attributes,
      productVersion: legacyProduct!.version,
      prices: legacyPrices.map((row) => row.minPriceAmount),
      search: (
        await prisma.catalogProduct.findUniqueOrThrow({
          where: { id: 'legacy-active' },
        })
      ).searchText,
    };
  });

  beforeEach(async () => {
    await prisma.mediaUsage.deleteMany();
    await prisma.catalogReview.deleteMany();
    await prisma.catalogAudit.deleteMany();
    await prisma.catalogVariant.deleteMany();
    await prisma.catalogProduct.deleteMany();
    await prisma.catalogCategory.updateMany({ data: { parentId: null } });
    await prisma.catalogCategory.deleteMany();
    await prisma.catalogBrand.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.shop.deleteMany();
    await prisma.user.deleteMany();
    category = await repository.createCategory({
      id: 'category-one',
      name: 'Coffee',
      slug: 'coffee',
      version: 0,
      createdAt: now,
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (directory) {
      const target = resolve(directory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !target.includes('marketplate-catalog-persistence-')
      ) {
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      }
      await rm(target, { recursive: true, force: true });
    }
  });

  it('backfills old catalog rows without changing product revisions or treating inactive zero prices as active', () => {
    expect(migratedLegacy).toEqual({
      categoryVersion: 0,
      images: [],
      attributes: {},
      productVersion: 7,
      prices: [150, null],
      search: 'ca phe dac biet legacy-active',
    });
  });

  it('prevents category cycles under concurrent reparenting and refuses to delete a parent', async () => {
    const other = await repository.createCategory({
      ...category,
      id: 'other-parent',
      slug: 'other-parent',
    });
    const results = await Promise.allSettled([
      repository.saveCategory(
        { ...category, parentId: other.id },
        category.version,
      ),
      repository.saveCategory(
        { ...other, parentId: category.id },
        other.version,
      ),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((row) => row.status === 'rejected');
    expect(failed?.reason).toBeInstanceOf(CatalogConflictError);
    const nodes = await repository.listCategories();
    const parent = nodes.find((node) =>
      nodes.some((child) => child.parentId === node.id),
    )!;
    await expect(
      repository.deleteCategory(parent.id, parent.version),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(nodes.filter((node) => node.parentId !== null)).toHaveLength(1);
  });

  it('validates category enum changes against existing variants and rolls back incompatible schemas', async () => {
    await repository.createProduct(
      product('enum-product', {
        variants: [variant('enum-sku', { attributes: { size: 'M' } })],
      }),
    );
    const defined = await repository.saveCategory(
      {
        ...category,
        attributeDefinitions: [
          { key: 'size', values: ['S', 'M'], required: true },
        ],
      },
      category.version,
    );
    await expect(
      repository.saveCategory(
        {
          ...defined,
          attributeDefinitions: [
            { key: 'size', values: ['S'], required: true },
          ],
        },
        defined.version,
      ),
    ).rejects.toThrow();
    expect(
      (await repository.findCategoryById(category.id))?.attributeDefinitions,
    ).toEqual(defined.attributeDefinitions);
    await expect(
      repository.createProduct(
        product('invalid-enum', {
          variants: [
            variant('invalid-enum-sku', { attributes: { size: 'L' } }),
          ],
        }),
      ),
    ).rejects.toThrow();
    expect(await repository.findProductById('invalid-enum')).toBeNull();
  });

  it('provides brand CAS and prevents deletion while any product references the brand', async () => {
    const brand = await repository.createBrand({
      id: 'brand',
      name: 'Maker',
      slug: 'maker',
      version: 0,
      createdAt: now,
    });
    const changed = await repository.saveBrand(
      { ...brand, name: 'Updated Maker' },
      0,
    );
    expect(changed.version).toBe(1);
    await expect(repository.saveBrand(brand, 0)).rejects.toBeInstanceOf(
      CatalogVersionConflictError,
    );
    const existing = await repository.createProduct(
      product('brand-product', { brandId: brand.id }),
    );
    await expect(
      repository.deleteBrand(brand.id, changed.version),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    await repository.saveProduct(
      { ...existing, brandId: null },
      existing.version,
    );
    await repository.deleteBrand(brand.id, changed.version);
    expect(await repository.findBrandById(brand.id)).toBeNull();
  });

  it('folds Vietnamese search and matches all attribute filters on one active variant', async () => {
    await repository.createProduct(
      product('red-small-blue-medium', {
        name: 'Cà phê ĐẶC BIỆT',
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [
          variant('red-small', { attributes: { color: 'red', size: 'S' } }),
          variant('blue-medium', { attributes: { color: 'blue', size: 'M' } }),
        ],
      }),
    );
    await repository.createProduct(
      product('red-medium', {
        name: 'CÀ PHÊ đặc biệt',
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [
          variant('red-medium-sku', {
            attributes: { color: 'red', size: 'M' },
          }),
          variant('inactive-white', {
            isActive: false,
            attributes: { color: 'white', size: 'L' },
          }),
        ],
      }),
    );
    const query = { page: 1, limit: 20, q: 'CA PHE DAC BIET' };
    expect((await repository.listPublishedProducts(query)).total).toBe(2);
    const selected = await repository.listPublishedProducts({
      ...query,
      attributes: { color: 'red', size: 'M' },
    });
    expect(selected.items.map((row) => row.id)).toEqual(['red-medium']);
    expect(selected.items[0]).not.toHaveProperty('variants');
    expect(selected.items[0]).not.toHaveProperty('description');
    expect(
      (
        await repository.listPublishedProducts({
          ...query,
          attributes: { color: 'white', size: 'L' },
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await repository.listPublishedProducts({
          ...query,
          attributes: { color: "red' OR 1=1 --" },
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await repository.listAdminProducts({
          ...query,
          attributes: { color: 'red', size: 'M' },
        })
      ).total,
    ).toBe(1);
  });

  it('uses a stable cursor without exact totals, duplicate rows or changed-filter reuse', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e'])
      await repository.createProduct(
        product('cursor-' + id, {
          status: 'PUBLISHED',
          publishedAt: now,
          variants: [variant('cursor-variant-' + id)],
        }),
      );
    const first = await repository.browsePublishedProducts({ limit: 2 });
    expect(first.items.map((row) => row.id)).toEqual(['cursor-e', 'cursor-d']);
    expect(first.hasNext).toBe(true);
    expect(first).not.toHaveProperty('total');
    await repository.createProduct(
      product('cursor-new', {
        createdAt: new Date(now.getTime() + 1000),
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('cursor-new-variant')],
      }),
    );
    const second = await repository.browsePublishedProducts({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((row) => row.id)).toEqual(['cursor-c', 'cursor-b']);
    const last = await repository.browsePublishedProducts({
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect(last.items.map((row) => row.id)).toEqual(['cursor-a']);
    expect(last).toMatchObject({ hasNext: false, nextCursor: null });
    await expect(
      repository.browsePublishedProducts({
        limit: 2,
        cursor: first.nextCursor!,
        q: 'changed',
      }),
    ).rejects.toThrow();
  });

  it('updates only changed variants and records the baseline/actor atomically', async () => {
    const before = await repository.createProduct(
      product('delta-product', {
        variants: [variant('delta-a'), variant('delta-b')],
      }),
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "_CatalogWriteProbe" ("variantId" TEXT NOT NULL)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER "_CatalogWriteTrigger" AFTER UPDATE ON "CatalogVariant" BEGIN INSERT INTO "_CatalogWriteProbe" ("variantId") VALUES (NEW."id"); END',
    );
    try {
      const renamed = await repository.saveProduct(
        { ...before, name: 'Only the name changed' },
        before.version,
      );
      expect(
        await prisma.$queryRawUnsafe('SELECT * FROM "_CatalogWriteProbe"'),
      ).toEqual([]);
      const edited = await repository.saveProduct(
        {
          ...renamed,
          variants: renamed.variants.map((row) =>
            row.id === 'delta-a' ? { ...row, priceAmount: 1000 } : row,
          ),
        },
        renamed.version,
      );
      expect(
        await prisma.$queryRawUnsafe('SELECT * FROM "_CatalogWriteProbe"'),
      ).toEqual([{ variantId: 'delta-a' }]);
      const history = await prisma.catalogAudit.findMany({
        where: { entityType: 'PRODUCT', entityId: before.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(history).toHaveLength(3);
      expect(history[1].before).toMatchObject({
        name: before.name,
        version: 0,
      });
      expect(history[1].after).toMatchObject({
        name: renamed.name,
        version: 1,
      });
      expect(edited.version).toBe(2);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER "_CatalogWriteTrigger"');
      await prisma.$executeRawUnsafe('DROP TABLE "_CatalogWriteProbe"');
    }
  });

  it('does not let a seller direct-write a published product or a stale draft with a pending review', async () => {
    const owner = await prisma.user.create({
      data: {
        id: 'seller',
        fullName: 'Seller',
        emailNormalized: 'seller@example.com',
        passwordHash: 'hash',
      },
    });
    const shop = await prisma.shop.create({
      data: { id: 'shop', name: 'Shop', slug: 'shop', ownerId: owner.id },
    });
    const context = {
      actor: { userId: owner.id, role: 'CUSTOMER' as const },
      shopId: shop.id,
      action: 'SELLER_UPDATE_PRODUCT',
    };
    const draft = await repository.createProduct(
      product('seller-draft', { shopId: shop.id }),
      context,
    );
    await prisma.catalogReview.create({
      data: {
        id: 'pending-review',
        productId: draft.id,
        baseVersion: draft.version,
        status: 'PENDING',
        snapshot: JSON.parse(JSON.stringify(draft)) as object,
      },
    });
    await expect(
      repository.saveProduct(
        { ...draft, name: 'Stale direct edit' },
        draft.version,
        context,
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect((await repository.findProductById(draft.id))?.version).toBe(0);
    const live = await repository.createProduct(
      product('seller-live', {
        shopId: shop.id,
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('seller-live-variant')],
      }),
    );
    await expect(
      repository.saveProduct(
        { ...live, name: 'Bypass review' },
        live.version,
        context,
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect((await repository.findProductById(live.id))?.version).toBe(0);
  });

  it('hides suspended shops and unavailable owners from every public read mode', async () => {
    const owner = await prisma.user.create({
      data: {
        id: 'public-owner',
        fullName: 'Seller',
        emailNormalized: 'public-owner@example.com',
        passwordHash: 'hash',
      },
    });
    const shop = await prisma.shop.create({
      data: {
        id: 'public-shop',
        name: 'Shop',
        slug: 'public-shop',
        ownerId: owner.id,
      },
    });
    const live = await repository.createProduct(
      product('shop-published', {
        shopId: shop.id,
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('shop-published-variant')],
      }),
    );
    expect(
      (
        await repository.listPublishedProducts({
          page: 1,
          limit: 20,
          shopId: shop.id,
        })
      ).total,
    ).toBe(1);
    await prisma.shop.update({
      where: { id: shop.id },
      data: { status: 'SUSPENDED' },
    });
    expect(
      (await repository.listPublishedProducts({ page: 1, limit: 20 })).total,
    ).toBe(0);
    expect(
      (await repository.browsePublishedProducts({ limit: 20 })).items,
    ).toEqual([]);
    expect(await repository.findPublishedProductBySlug(live.slug)).toBeNull();
    await prisma.shop.update({
      where: { id: shop.id },
      data: { status: 'ACTIVE' },
    });
    await prisma.user.update({
      where: { id: owner.id },
      data: { status: 'LOCKED' },
    });
    expect(
      (await repository.browsePublishedProducts({ limit: 20 })).items,
    ).toEqual([]);
    expect(await repository.findPublishedProductBySlug(live.slug)).toBeNull();
  });

  it('persists empty draft aggregates and lists categories in name order', async () => {
    const another = await repository.createCategory({
      id: 'category-two',
      name: 'Bakery',
      slug: 'bakery',
      version: 0,
      createdAt: now,
    });
    const saved = await repository.createProduct(product('new-product'));
    expect(saved).toEqual(product('new-product'));
    expect(await repository.findProductById(saved.id)).toEqual(saved);
    expect(await repository.findCategoryById(category.id)).toEqual(category);
    expect(await repository.listCategories()).toEqual([another, category]);
  });

  it('maps category and product slug uniqueness to catalog conflicts', async () => {
    await expect(
      repository.createCategory({ ...category, id: 'other-category' }),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    await repository.createProduct(
      product('first-product', { slug: 'unique-slug' }),
    );
    await expect(
      repository.createProduct(
        product('second-product', { slug: 'unique-slug' }),
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);
  });

  it('updates categories using CAS while preserving their creation timestamp', async () => {
    const updated = await repository.saveCategory(
      {
        ...category,
        name: 'Renamed coffee',
        slug: 'renamed-coffee',
        createdAt: new Date(0),
      },
      category.version,
    );
    expect(updated).toEqual({
      ...category,
      name: 'Renamed coffee',
      slug: 'renamed-coffee',
      version: 1,
    });
    await expect(
      repository.saveCategory({ ...updated, name: 'Stale overwrite' }, 0),
    ).rejects.toBeInstanceOf(CatalogVersionConflictError);
    await expect(
      repository.deleteCategory(category.id, 0),
    ).rejects.toBeInstanceOf(CatalogVersionConflictError);
    expect(await repository.findCategoryById(category.id)).toEqual(updated);
    await repository.deleteCategory(category.id, updated.version);
    expect(await repository.findCategoryById(category.id)).toBeNull();
    await expect(
      repository.deleteCategory(category.id, updated.version),
    ).rejects.toBeInstanceOf(CatalogNotFoundError);
    await expect(
      repository.saveCategory(updated, updated.version),
    ).rejects.toBeInstanceOf(CatalogNotFoundError);
  });

  it('rolls back category revisions when a slug is already reserved', async () => {
    await repository.createCategory({
      ...category,
      id: 'occupied-category',
      slug: 'occupied',
    });
    await expect(
      repository.saveCategory(
        { ...category, name: 'Must roll back', slug: 'occupied' },
        0,
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(await repository.findCategoryById(category.id)).toEqual(category);
  });

  it('permits only one category writer for a shared version', async () => {
    const results = await Promise.allSettled(
      ['One', 'Two'].map((name) =>
        repository.saveCategory({ ...category, name }, category.version),
      ),
    );
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBeInstanceOf(CatalogVersionConflictError);
    expect(await repository.findCategoryById(category.id)).toEqual(
      successes[0].value,
    );
    expect(successes[0].value.version).toBe(1);
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
    'keeps categories referenced by a %s product',
    async (status) => {
      await repository.createProduct(
        product('category-dependent', {
          status,
          publishedAt: status === 'PUBLISHED' ? now : null,
          variants: [variant('category-dependent-variant')],
        }),
      );
      await expect(
        repository.deleteCategory(category.id, category.version),
      ).rejects.toBeInstanceOf(CatalogConflictError);
      expect(await repository.findCategoryById(category.id)).toEqual(category);
      expect(
        await repository.findProductById('category-dependent'),
      ).not.toBeNull();
    },
  );

  it('keeps foreign-key integrity when category deletion races a product insert on a second connection', async () => {
    const otherPrisma = new PrismaService();
    await otherPrisma.$connect();
    try {
      const otherRepository = new PrismaCatalogRepository(otherPrisma);
      const results = await Promise.allSettled([
        repository.deleteCategory(category.id, category.version),
        otherRepository.createProduct(product('category-racing-product')),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const failures = results.filter((result) => result.status === 'rejected');
      expect(failures).toHaveLength(1);
      const storedCategory = await repository.findCategoryById(category.id);
      const storedProduct = await repository.findProductById(
        'category-racing-product',
      );
      if (storedCategory === null) {
        expect(storedProduct).toBeNull();
        expect(failures[0].reason).toBeInstanceOf(CatalogNotFoundError);
      } else {
        expect(storedProduct?.categoryId).toBe(category.id);
        expect(failures[0].reason).toBeInstanceOf(CatalogConflictError);
      }
    } finally {
      await otherPrisma.$disconnect();
    }
  }, 15_000);

  it('maps a missing category to a not-found error and keeps its FK restrictive', async () => {
    await expect(
      repository.createProduct(
        product('orphan', { categoryId: 'missing-category' }),
      ),
    ).rejects.toBeInstanceOf(CatalogNotFoundError);
    expect(await repository.findProductById('orphan')).toBeNull();
    await repository.createProduct(product('dependent-product'));
    await expect(
      prisma.catalogCategory.delete({ where: { id: category.id } }),
    ).rejects.toThrow();
    expect(await repository.findCategoryById(category.id)).toEqual(category);
  });

  it('enforces globally unique SKUs across product aggregates', async () => {
    await repository.createProduct(
      product('first', {
        variants: [variant('first-variant', { sku: 'GLOBAL-SKU' })],
      }),
    );
    await expect(
      repository.createProduct(
        product('second', {
          variants: [variant('second-variant', { sku: 'GLOBAL-SKU' })],
        }),
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(await repository.findProductById('second')).toBeNull();
  });

  it('updates variants in place and returns the incremented durable version', async () => {
    const before = await repository.createProduct(
      product('editable', {
        variants: [variant('stable-variant')],
      }),
    );
    const after = await repository.saveProduct(
      {
        ...before,
        name: 'Updated name',
        updatedAt: new Date(now.getTime() + 1000),
        variants: [
          {
            ...before.variants[0],
            name: 'New size',
            priceAmount: 30_000,
            isActive: false,
          },
        ],
      },
      before.version,
    );
    expect(after.version).toBe(1);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.variants).toEqual([
      {
        ...before.variants[0],
        name: 'New size',
        priceAmount: 30_000,
        isActive: false,
      },
    ]);
    expect(
      await prisma.catalogVariant.count({ where: { productId: before.id } }),
    ).toBe(1);
  });

  it('round-trips images and editable variant attributes without exposing mutable persisted references', async () => {
    const before = await repository.createProduct(
      product('media-product', {
        images: [{ url: 'https://example.com/coffee.jpg', alt: 'Coffee bag' }],
        variants: [
          variant('media-variant', {
            attributes: { size: '250g', roast: 'medium' },
          }),
        ],
      }),
    );
    const copy = await repository.findProductById(before.id);
    copy!.images[0].alt = 'External mutation';
    copy!.variants[0].attributes.size = 'External mutation';
    expect(await repository.findProductById(before.id)).toEqual(before);
    const after = await repository.saveProduct(
      {
        ...before,
        images: [{ url: 'https://example.com/new.jpg', alt: 'New bag' }],
        variants: [
          {
            ...before.variants[0],
            attributes: { size: '500g', roast: 'dark' },
          },
        ],
      },
      before.version,
    );
    expect(after.images).toEqual([
      { url: 'https://example.com/new.jpg', alt: 'New bag' },
    ]);
    expect(after.variants[0].attributes).toEqual({
      size: '500g',
      roast: 'dark',
    });
    expect(after.variants[0].id).toBe(before.variants[0].id);
    expect(after.variants[0].sku).toBe(before.variants[0].sku);
    expect(await repository.findProductById(before.id)).toEqual(after);
  });

  it('derives the starting price on every save instead of trusting a caller-supplied projection', async () => {
    const forged = Object.assign(
      product('derived-price', {
        variants: [
          variant('derived-low', { priceAmount: 100 }),
          variant('derived-high', { priceAmount: 500 }),
          variant('derived-inactive', { priceAmount: 0, isActive: false }),
        ],
      }),
      { minPriceAmount: 99 },
    );
    const before = await repository.createProduct(forged);
    expect(
      (
        await prisma.catalogProduct.findUniqueOrThrow({
          where: { id: before.id },
        })
      ).minPriceAmount,
    ).toBe(100);
    const after = await repository.saveProduct(
      {
        ...before,
        variants: before.variants.map((item) => ({
          ...item,
          isActive: item.id === 'derived-high',
        })),
      },
      before.version,
    );
    expect(
      (
        await prisma.catalogProduct.findUniqueOrThrow({
          where: { id: before.id },
        })
      ).minPriceAmount,
    ).toBe(500);
    await repository.saveProduct(
      {
        ...after,
        variants: after.variants.map((item) => ({ ...item, isActive: false })),
      },
      after.version,
    );
    expect(
      (
        await prisma.catalogProduct.findUniqueOrThrow({
          where: { id: before.id },
        })
      ).minPriceAmount,
    ).toBeNull();
  });

  it('allows exactly one concurrent writer for the same aggregate version', async () => {
    const before = await repository.createProduct(
      product('concurrent', {
        variants: [variant('original-variant')],
      }),
    );
    const results = await Promise.allSettled(
      [100, 200].map((priceAmount) =>
        repository.saveProduct(
          {
            ...before,
            name: `Writer ${priceAmount}`,
            variants: [{ ...before.variants[0], priceAmount }],
          },
          before.version,
        ),
      ),
    );
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBeInstanceOf(CatalogVersionConflictError);
    const stored = await repository.findProductById(before.id);
    expect(stored).toEqual(successes[0].value);
    expect(stored?.version).toBe(1);
  });

  it('checks aggregate versions across independent SQLite connections', async () => {
    const before = await repository.createProduct(
      product('independent-connections', {
        variants: [variant('shared-variant')],
      }),
    );
    const otherPrisma = new PrismaService();
    await otherPrisma.$connect();
    try {
      const otherRepository = new PrismaCatalogRepository(otherPrisma);
      const results = await Promise.allSettled(
        [repository, otherRepository].map((writer, index) =>
          writer.saveProduct(
            {
              ...before,
              name: `Connection ${index}`,
              variants: [
                { ...before.variants[0], priceAmount: 10_000 + index },
              ],
            },
            before.version,
          ),
        ),
      );
      const successes = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const failures = results.filter((result) => result.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toBeInstanceOf(CatalogVersionConflictError);
      const stored = await repository.findProductById(before.id);
      expect(stored).toEqual(successes[0].value);
      expect(stored?.version).toBe(1);
      expect(await otherRepository.findProductById(before.id)).toEqual(stored);
    } finally {
      await otherPrisma.$disconnect();
    }
  }, 15_000);

  it('retries storage contention without rejecting independent product revisions', async () => {
    const products = await Promise.all([
      repository.createProduct(
        product('independent-one', {
          variants: [variant('independent-variant-one')],
        }),
      ),
      repository.createProduct(
        product('independent-two', {
          variants: [variant('independent-variant-two')],
        }),
      ),
    ]);
    const otherPrisma = new PrismaService();
    await otherPrisma.$connect();
    try {
      const writers = [repository, new PrismaCatalogRepository(otherPrisma)];
      const saved = await Promise.all(
        products.map((snapshot, index) =>
          writers[index].saveProduct(
            {
              ...snapshot,
              name: `Independent update ${index}`,
              variants: [
                { ...snapshot.variants[0], priceAmount: 20_000 + index },
              ],
            },
            snapshot.version,
          ),
        ),
      );
      for (const [index, snapshot] of saved.entries()) {
        expect(snapshot.version).toBe(1);
        expect(snapshot.name).toBe(`Independent update ${index}`);
        expect(snapshot.variants[0].priceAmount).toBe(20_000 + index);
        expect(await repository.findProductById(snapshot.id)).toEqual(snapshot);
      }
    } finally {
      await otherPrisma.$disconnect();
    }
  }, 15_000);

  it('rolls back the aggregate claim and earlier child writes when a later SKU conflicts', async () => {
    const before = await repository.createProduct(
      product('rollback', {
        variants: [variant('existing-variant')],
      }),
    );
    await repository.createProduct(
      product('other-product', {
        variants: [variant('other-variant', { sku: 'OCCUPIED' })],
      }),
    );
    await expect(
      repository.saveProduct(
        {
          ...before,
          name: 'Must roll back',
          images: [
            { url: 'https://example.com/rollback.jpg', alt: 'Must roll back' },
          ],
          variants: [
            ...before.variants,
            variant('first-insert', {
              priceAmount: 1,
              attributes: { size: 'new' },
            }),
            variant('conflicting-insert', { sku: 'OCCUPIED' }),
          ],
        },
        before.version,
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(await repository.findProductById(before.id)).toEqual(before);
    expect(
      await prisma.catalogVariant.findUnique({ where: { id: 'first-insert' } }),
    ).toBeNull();
    expect(
      (
        await prisma.catalogProduct.findUniqueOrThrow({
          where: { id: before.id },
        })
      ).minPriceAmount,
    ).toBe(before.variants[0].priceAmount);
  });

  it('does not permit a variant ID to mutate another product', async () => {
    const before = await repository.createProduct(product('owner-one'));
    const other = await repository.createProduct(
      product('owner-two', {
        variants: [variant('foreign-variant')],
      }),
    );
    await expect(
      repository.saveProduct(
        {
          ...before,
          variants: [
            variant('foreign-variant', { sku: 'HIJACKED', name: 'Changed' }),
          ],
        },
        before.version,
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(await repository.findProductById(before.id)).toEqual(before);
    expect(await repository.findProductById(other.id)).toEqual(other);
  });

  it('rejects snapshots that drop a stored variant and preserves its SKU', async () => {
    const before = await repository.createProduct(
      product('retained', {
        variants: [variant('reserved-sku')],
      }),
    );
    await expect(
      repository.saveProduct({ ...before, variants: [] }, before.version),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(await repository.findProductById(before.id)).toEqual(before);
  });

  it('distinguishes missing aggregates from stale revisions without creating rows', async () => {
    await expect(
      repository.saveProduct(product('missing'), 0),
    ).rejects.toBeInstanceOf(CatalogNotFoundError);
    const before = await repository.createProduct(product('present'));
    await expect(repository.saveProduct(before, 4)).rejects.toBeInstanceOf(
      CatalogVersionConflictError,
    );
    expect(await repository.findProductById(before.id)).toEqual(before);
  });

  it('filters drafts, archived products and inactive variants in public queries', async () => {
    const draft = await repository.createProduct(product('draft'));
    const archived = await repository.createProduct(
      product('archived', { status: 'ARCHIVED' }),
    );
    const published = await repository.createProduct(
      product('published', {
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('active'), variant('inactive', { isActive: false })],
      }),
    );
    expect(await repository.findPublishedProductBySlug(draft.slug)).toBeNull();
    expect(
      await repository.findPublishedProductBySlug(archived.slug),
    ).toBeNull();
    expect(
      (await repository.findPublishedProductBySlug(published.slug))?.variants,
    ).toEqual([variant('active')]);
    const page = await repository.listPublishedProducts({ page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual([published.id]);
    expect(page.items[0].priceFromAmount).toBe(variant('active').priceAmount);
    expect(page.items[0]).not.toHaveProperty('variants');
    expect(page.items[0]).not.toHaveProperty('description');
    expect(
      (await repository.findProductById(published.id))?.variants,
    ).toHaveLength(2);
  });

  it('combines search, category and status filters with stable pagination and totals', async () => {
    const otherCategory = await repository.createCategory({
      id: 'another-category',
      name: 'Tea',
      slug: 'tea',
      version: 0,
      createdAt: now,
    });
    for (const snapshot of [
      product('a-coffee', {
        name: 'Coffee Alpha',
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('alpha')],
      }),
      product('b-coffee', {
        name: 'coffee Beta',
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('beta')],
      }),
      product('c-draft', { name: 'Coffee Draft' }),
      product('d-other', {
        name: 'Coffee Other',
        categoryId: otherCategory.id,
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('other')],
      }),
    ]) {
      await repository.createProduct(snapshot);
    }
    const query = { page: 1, limit: 1, q: 'COFFEE', categoryId: category.id };
    const first = await repository.listPublishedProducts(query);
    const second = await repository.listPublishedProducts({
      ...query,
      page: 2,
    });
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(first.items.map((item) => item.id)).toEqual(['b-coffee']);
    expect(second.items.map((item) => item.id)).toEqual(['a-coffee']);
    const draft = await repository.listAdminProducts({
      ...query,
      status: 'DRAFT',
    });
    expect(draft.total).toBe(1);
    expect(draft.items[0].id).toBe('c-draft');
  });

  it('filters and sorts by the minimum active price with inclusive bounds and stable ties', async () => {
    for (const snapshot of [
      product('price-a', {
        name: 'Zeta',
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [
          variant('price-a-low', { priceAmount: 100 }),
          variant('price-a-high', { priceAmount: 900 }),
          variant('price-a-inactive', { priceAmount: 0, isActive: false }),
        ],
      }),
      product('price-b', {
        name: 'Alpha',
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [
          variant('price-b-low', { priceAmount: 500 }),
          variant('price-b-high', { priceAmount: 900 }),
        ],
      }),
      product('price-c', {
        name: 'Alpha',
        status: 'PUBLISHED',
        publishedAt: now,
        variants: [variant('price-c-low', { priceAmount: 500 })],
      }),
      product('price-zero', {
        variants: [variant('price-zero-active', { priceAmount: 0 })],
      }),
      product('price-none', {
        variants: [
          variant('price-none-inactive', { priceAmount: 0, isActive: false }),
        ],
      }),
    ])
      await repository.createProduct(snapshot);
    const query = { page: 1, limit: 10 };
    expect(
      (
        await repository.listPublishedProducts({
          ...query,
          minPrice: 500,
          maxPrice: 500,
        })
      ).items.map((row) => row.id),
    ).toEqual(['price-c', 'price-b']);
    expect(
      (
        await repository.listPublishedProducts({
          ...query,
          minPrice: 800,
          maxPrice: 1000,
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await repository.listPublishedProducts({ ...query, sort: 'price-asc' })
      ).items.map((row) => row.id),
    ).toEqual(['price-a', 'price-c', 'price-b']);
    expect(
      (
        await repository.listPublishedProducts({ ...query, sort: 'price-desc' })
      ).items.map((row) => row.id),
    ).toEqual(['price-c', 'price-b', 'price-a']);
    expect(
      (
        await repository.listPublishedProducts({
          ...query,
          sort: 'price-asc',
          page: 2,
          limit: 1,
        })
      ).items.map((row) => row.id),
    ).toEqual(['price-c']);
    expect(
      (
        await repository.listPublishedProducts({ ...query, sort: 'name-asc' })
      ).items.map((row) => row.id),
    ).toEqual(['price-c', 'price-b', 'price-a']);
    expect(
      (
        await repository.listAdminProducts({ ...query, sort: 'price-asc' })
      ).items.map((row) => row.id),
    ).toEqual(['price-zero', 'price-a', 'price-c', 'price-b', 'price-none']);
    expect(
      (
        await repository.listAdminProducts({ ...query, sort: 'price-desc' })
      ).items.map((row) => row.id),
    ).toEqual(['price-c', 'price-b', 'price-a', 'price-zero', 'price-none']);
    expect(
      (
        await repository.listAdminProducts({
          ...query,
          minPrice: 0,
          maxPrice: 0,
        })
      ).items.map((row) => row.id),
    ).toEqual(['price-zero']);
  });

  it('rejects invalid persisted image and attribute shapes instead of leaking arbitrary JSON', async () => {
    await repository.createProduct(
      product('bad-json', { variants: [variant('bad-json-variant')] }),
    );
    await prisma.catalogProduct.update({
      where: { id: 'bad-json' },
      data: { images: [{ url: 123, alt: 'Invalid' }] },
    });
    await expect(repository.findProductById('bad-json')).rejects.toThrow(
      'Unsupported persisted product image',
    );
    await prisma.catalogProduct.update({
      where: { id: 'bad-json' },
      data: { images: [] },
    });
    await prisma.catalogVariant.update({
      where: { id: 'bad-json-variant' },
      data: { attributes: { size: 123 } },
    });
    await expect(repository.findProductById('bad-json')).rejects.toThrow(
      'Unsupported persisted variant attribute',
    );
  });

  it.each([
    { priceAmount: -1 },
    { priceAmount: 2147483648 },
    { currency: 'USD' },
  ])(
    'keeps SQL price and currency constraints as a persistence backstop: %j',
    async (invalid) => {
      await repository.createProduct(product('constraint-parent'));
      await expect(
        prisma.catalogVariant.create({
          data: {
            id: 'invalid-variant',
            productId: 'constraint-parent',
            sku: 'INVALID',
            name: 'Invalid',
            priceAmount: 100,
            currency: 'VND',
            ...invalid,
          },
        }),
      ).rejects.toThrow();
      expect(await prisma.catalogVariant.count()).toBe(0);
    },
  );
});
