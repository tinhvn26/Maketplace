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
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import {
  Product,
  type ProductSnapshot,
} from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import { PrismaCatalogRepository } from './prisma-catalog.repository.js';
import { PrismaCatalogWorkflowRepository } from './prisma-catalog-workflow.repository.js';

describe('Catalog workflow SQLite transaction boundaries', () => {
  let directory: string;
  let prisma: PrismaService;
  let catalog: PrismaCatalogRepository;
  let workflow: PrismaCatalogWorkflowRepository;
  const now = new Date('2026-11-03T00:00:00.000Z');
  const seller: CatalogMutationContext = {
    actor: { userId: 'seller', role: 'CUSTOMER' },
    shopId: 'shop',
    action: 'SELLER_EDIT_PRODUCT',
  };
  const admin: CatalogMutationContext = {
    actor: { userId: 'admin', role: 'ADMIN' },
    action: 'ADMIN_REVIEW_PRODUCT',
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-workflow-test-'));
    const url = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', url);
    const connection = await new PrismaBetterSqlite3({ url }).connect();
    try {
      const migrations = new URL(
        '../../../../../prisma/migrations/',
        import.meta.url,
      );
      for (const entry of (await readdir(migrations, { withFileTypes: true }))
        .filter((row) => row.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
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
    catalog = new PrismaCatalogRepository(prisma);
    workflow = new PrismaCatalogWorkflowRepository(prisma, catalog);
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
    await prisma.user.createMany({
      data: [
        {
          id: 'seller',
          fullName: 'Seller',
          emailNormalized: 'seller@example.com',
          passwordHash: 'hash',
          role: 'CUSTOMER',
        },
        {
          id: 'admin',
          fullName: 'Admin',
          emailNormalized: 'admin@example.com',
          passwordHash: 'hash',
          role: 'ADMIN',
        },
      ],
    });
    await prisma.shop.create({
      data: { id: 'shop', ownerId: 'seller', name: 'Shop', slug: 'shop' },
    });
    await catalog.createCategory(
      {
        id: 'category',
        name: 'Category',
        slug: 'category',
        version: 0,
        createdAt: now,
      },
      admin,
    );
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (directory) {
      const target = resolve(directory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !target.includes('marketplate-workflow-test-')
      )
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      await rm(target, { recursive: true, force: true });
    }
  });

  async function product(
    id: string,
    published = false,
    attributes: Record<string, string> = {},
  ): Promise<ProductSnapshot> {
    const aggregate = Product.create({
      id,
      shopId: 'shop',
      categoryId: 'category',
      name: id,
      slug: id,
      now,
    });
    aggregate.addVariant(
      {
        id: id + '-variant',
        sku: id.toUpperCase(),
        name: 'Default',
        priceAmount: 1000,
        attributes,
      },
      now,
    );
    if (published) aggregate.publish(now);
    return catalog.createProduct(aggregate.toSnapshot(), admin);
  }
  async function proposed(
    snapshot: ProductSnapshot,
    edit: (aggregate: Product) => void,
  ) {
    const aggregate = Product.restore(snapshot);
    edit(aggregate);
    const state = await workflow.saveRevision(
      aggregate.toSnapshot(),
      snapshot.version,
      undefined,
      seller,
    );
    return workflow.submit(
      snapshot.id,
      snapshot.version,
      state.revision!.version,
      seller,
    );
  }

  it.each(['sku', 'slug'] as const)(
    'rolls back an approval claim, aggregate and audit when a duplicate %s conflicts',
    async (duplicate) => {
      const original = await product('target');
      const occupied = await product('occupied');
      const state = await proposed(original, (aggregate) => {
        if (duplicate === 'slug')
          aggregate.updateDetails({ slug: occupied.slug }, now);
        else
          aggregate.addVariant(
            {
              id: 'new-collision',
              sku: occupied.variants[0].sku,
              name: 'Collision',
              priceAmount: 1000,
            },
            now,
          );
      });
      const pending = state.revision!;
      const beforeReview = await prisma.catalogReview.findUniqueOrThrow({
        where: { id: pending.id },
      });
      const auditCount = await prisma.catalogAudit.count();
      await expect(
        workflow.review(pending.id, pending.version, true, undefined, admin),
      ).rejects.toBeInstanceOf(CatalogConflictError);
      expect(
        await prisma.catalogReview.findUniqueOrThrow({
          where: { id: pending.id },
        }),
      ).toEqual(beforeReview);
      expect(await catalog.findProductById(original.id)).toEqual(original);
      expect(await prisma.catalogAudit.count()).toBe(auditCount);
      expect(
        await prisma.catalogVariant.findUnique({
          where: { id: 'new-collision' },
        }),
      ).toBeNull();
    },
  );

  it('allows exactly one approval across independent SQLite connections', async () => {
    const original = await product('approval-race');
    const state = await workflow.submit(
      original.id,
      original.version,
      undefined,
      seller,
    );
    const review = state.revision!;
    const second = new PrismaService();
    await second.$connect();
    try {
      const other = new PrismaCatalogWorkflowRepository(
        second,
        new PrismaCatalogRepository(second),
      );
      const results = await Promise.allSettled(
        [workflow, other].map((writer) =>
          writer.review(review.id, review.version, true, 'Approved', admin),
        ),
      );
      expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(
        1,
      );
      const failed = results.find((row) => row.status === 'rejected');
      expect(failed?.reason).toBeInstanceOf(CatalogVersionConflictError);
      expect(await catalog.findProductById(original.id)).toMatchObject({
        status: 'PUBLISHED',
        version: 1,
      });
      expect(
        await prisma.catalogReview.findUniqueOrThrow({
          where: { id: review.id },
        }),
      ).toMatchObject({
        status: 'APPROVED',
        version: review.version + 1,
        reviewedBy: 'admin',
      });
      expect(
        await prisma.catalogAudit.count({
          where: {
            actorId: 'admin',
            action: 'APPROVE_PRODUCT',
            entityId: original.id,
          },
        }),
      ).toBe(1);
    } finally {
      await second.$disconnect();
    }
  }, 15_000);

  it('rejects a stale proposal revision without changing the live aggregate', async () => {
    const original = await product('revision-race', true);
    const initial = Product.restore(original);
    initial.updateDetails({ name: 'Initial proposal' }, now);
    const first = await workflow.saveRevision(
      initial.toSnapshot(),
      original.version,
      undefined,
      seller,
    );
    const version = first.revision!.version;
    const results = await Promise.allSettled(
      ['One', 'Two'].map((name) => {
        const edit = Product.restore(original);
        edit.updateDetails({ name }, now);
        return workflow.saveRevision(
          edit.toSnapshot(),
          original.version,
          version,
          seller,
        );
      }),
    );
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.find((row) => row.status === 'rejected')?.reason,
    ).toBeInstanceOf(CatalogVersionConflictError);
    expect(await catalog.findProductById(original.id)).toEqual(original);
    const current = await workflow.load(original.id, 'shop');
    expect(current?.revision?.version).toBe(version + 1);
    expect(['One', 'Two']).toContain(current?.revision?.snapshot.name);
  });

  it('withdraws a draft publication into an editable proposal while retaining its managed media references', async () => {
    const original = await product('withdraw-draft');
    const asset = await prisma.mediaAsset.create({
      data: {
        id: 'proposal-image',
        shopId: 'shop',
        ownerId: 'seller',
        storageKey: 'proposal-image',
        mimeType: 'image/png',
        byteSize: 100,
        width: 10,
        height: 10,
      },
    });
    const state = await proposed(original, (aggregate) =>
      aggregate.updateDetails(
        {
          images: [
            {
              url: 'https://example.com/proposal.png',
              alt: 'Proposal',
              assetId: asset.id,
            },
          ],
        },
        now,
      ),
    );
    const review = state.revision!;
    const usage = await prisma.mediaUsage.findMany({
      where: { kind: 'CATALOG_REVIEW', resourceId: review.id },
    });
    expect(usage).toHaveLength(1);
    const withdrawn = await workflow.withdraw(
      original.id,
      original.version,
      review.version,
      seller,
    );
    expect(withdrawn.product).toEqual(original);
    expect(withdrawn.revision).toMatchObject({
      status: 'DRAFT',
      version: review.version + 1,
      note: 'WITHDRAWN',
      snapshot: {
        status: 'DRAFT',
        publishedAt: null,
        images: [{ assetId: asset.id }],
      },
    });
    expect(
      await prisma.mediaUsage.findMany({
        where: { kind: 'CATALOG_REVIEW', resourceId: review.id },
      }),
    ).toEqual(usage);
  });

  it.each(['shop', 'actor'] as const)(
    'rechecks a stale %s authorization after the application precheck',
    async (invalidated) => {
      const original = await product('stale-authorization');
      expect(await workflow.load(original.id, 'shop')).not.toBeNull();
      const audits = await prisma.catalogAudit.count();
      if (invalidated === 'shop')
        await prisma.shop.update({
          where: { id: 'shop' },
          data: { status: 'SUSPENDED' },
        });
      else
        await prisma.user.update({
          where: { id: 'seller' },
          data: { status: 'LOCKED' },
        });
      await expect(
        workflow.submit(original.id, original.version, undefined, seller),
      ).rejects.toBeInstanceOf(CatalogNotFoundError);
      expect(await prisma.catalogReview.count()).toBe(0);
      expect(await catalog.findProductById(original.id)).toEqual(original);
      expect(await prisma.catalogAudit.count()).toBe(audits);
    },
  );

  it('revalidates category enum changes during approval and retains the pending proposal on failure', async () => {
    const category = (await catalog.findCategoryById('category'))!;
    const defined = await catalog.saveCategory(
      {
        ...category,
        attributeDefinitions: [
          { key: 'color', values: ['red', 'blue'], required: true },
        ],
      },
      category.version,
      admin,
    );
    const original = await product('schema-change', false, { color: 'red' });
    const state = await proposed(original, (aggregate) =>
      aggregate.updateVariant(
        original.variants[0].id,
        { attributes: { color: 'blue' } },
        now,
      ),
    );
    const review = state.revision!;
    await catalog.saveCategory(
      {
        ...defined,
        attributeDefinitions: [
          { key: 'color', values: ['red'], required: true },
        ],
      },
      defined.version,
      admin,
    );
    const audits = await prisma.catalogAudit.count();
    await expect(
      workflow.review(review.id, review.version, true, undefined, admin),
    ).rejects.toThrow('not an allowed category option');
    expect(
      await prisma.catalogReview.findUniqueOrThrow({
        where: { id: review.id },
      }),
    ).toMatchObject({
      status: 'PENDING',
      version: review.version,
      reviewedBy: null,
    });
    expect(await catalog.findProductById(original.id)).toEqual(original);
    expect(await prisma.catalogAudit.count()).toBe(audits);
  });
});
