import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { Category } from '../../domain/entities/category.js';
import type { Brand } from '../../domain/entities/brand.js';
import type {
  ProductSnapshot,
  ProductVariant,
} from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import {
  normalizeCategoryAttributeDefinitions,
  validateVariantsForCategory,
} from '../../domain/policies/category-attributes.policy.js';
import { normalizeCatalogSearch } from '../../domain/policies/catalog-search.policy.js';
import type {
  AdminProductListQuery,
  CatalogRepository,
  ProductListQuery,
  ProductPage,
  ProductSummary,
  ProductSummaryPage,
  CatalogBrowseQuery,
  CatalogBrowsePage,
} from '../../application/ports/catalog.repository.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  normalizeCatalogBrowseQuery,
} from '../../application/query/catalog-cursor.js';
import { normalizeProductQuery } from '../../application/shared/catalog-query.policy.js';
import {
  assertCatalogWrite,
  auditCatalog,
  catalogJson,
  syncCatalogMedia,
} from '../integrations/catalog-integrity.js';

type PersistedProduct = Prisma.CatalogProductGetPayload<{
  include: { variants: true };
}>;
type CategoryRow = Prisma.CatalogCategoryGetPayload<object>;
type SummaryRow = {
  id: string;
  categoryId: string;
  shopId: string | null;
  brandId: string | null;
  name: string;
  slug: string;
  coverImage: unknown;
  minPriceAmount: number | null;
  createdAt: Date | number | string;
  updatedAt: Date | number | string;
  publishedAt: Date | number | string | null;
};

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}
  runInTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.retry(() => this.prisma.$transaction(work));
  }

  async listCategories(): Promise<Category[]> {
    return (
      await this.prisma.catalogCategory.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })
    ).map((row) => this.category(row));
  }
  async findCategoryById(id: string): Promise<Category | null> {
    const row = await this.prisma.catalogCategory.findUnique({ where: { id } });
    return row ? this.category(row) : null;
  }
  async createCategory(
    category: Category,
    context?: CatalogMutationContext,
  ): Promise<Category> {
    return this.retry(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.catalogCategory.create({
          data: {
            ...category,
            parentId: category.parentId ?? null,
            attributeDefinitions: catalogJson(
              category.attributeDefinitions ?? [],
            ),
          },
        });
        await assertCatalogWrite(tx, context, null);
        await this.checkCategoryParent(tx, row.id, row.parentId);
        const result = this.category(row);
        await auditCatalog(tx, context, 'CATEGORY', row.id, null, result);
        return result;
      }),
    );
  }
  async saveCategory(
    category: Category,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<Category> {
    return this.retry(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "CatalogCategory" SET "version" = "version" WHERE "id" = ${category.id}`;
        const before = await tx.catalogCategory.findUnique({
          where: { id: category.id },
        });
        if (!before) throw new CatalogNotFoundError('Category not found');
        await assertCatalogWrite(tx, context, null);
        if (before.version !== expectedVersion)
          throw new CatalogVersionConflictError();
        await this.checkCategoryParent(
          tx,
          category.id,
          category.parentId ?? null,
        );
        const definitions = normalizeCategoryAttributeDefinitions(
          category.attributeDefinitions ?? [],
        );
        if (
          JSON.stringify(before.attributeDefinitions) !==
          JSON.stringify(definitions)
        ) {
          const existing = await tx.catalogVariant.findMany({
            where: { product: { categoryId: category.id } },
            select: { attributes: true },
          });
          validateVariantsForCategory(
            { attributeDefinitions: definitions },
            existing.map((row) => ({
              attributes: this.persistedAttributes(row.attributes),
            })),
          );
        }
        const changed = await tx.catalogCategory.updateMany({
          where: { id: category.id, version: expectedVersion },
          data: {
            name: category.name,
            slug: category.slug,
            parentId: category.parentId ?? null,
            attributeDefinitions: catalogJson(definitions),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new CatalogVersionConflictError();
        const result = this.category(
          await tx.catalogCategory.findUniqueOrThrow({
            where: { id: category.id },
          }),
        );
        await auditCatalog(
          tx,
          context,
          'CATEGORY',
          category.id,
          this.category(before),
          result,
        );
        return result;
      }),
    );
  }
  async deleteCategory(
    id: string,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<void> {
    return this.retry(
      () =>
        this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE "CatalogCategory" SET "version" = "version" WHERE "id" = ${id}`;
          const before = await tx.catalogCategory.findUnique({ where: { id } });
          if (!before) throw new CatalogNotFoundError('Category not found');
          await assertCatalogWrite(tx, context, null);
          if (before.version !== expectedVersion)
            throw new CatalogVersionConflictError();
          const deleted = await tx.catalogCategory.deleteMany({
            where: {
              id,
              version: expectedVersion,
              products: { none: {} },
              children: { none: {} },
            },
          });
          if (deleted.count !== 1)
            throw new CatalogConflictError(
              'Category still contains products or child categories',
            );
          await auditCatalog(
            tx,
            context,
            'CATEGORY',
            id,
            this.category(before),
            null,
          );
        }),
      true,
    );
  }
  private async checkCategoryParent(
    tx: Prisma.TransactionClient,
    id: string,
    parentId: string | null,
  ): Promise<void> {
    const seen = new Set([id]);
    let current = parentId;
    while (current !== null) {
      if (seen.has(current))
        throw new CatalogConflictError(
          'Category hierarchy cannot contain cycles',
        );
      seen.add(current);
      const parent = await tx.catalogCategory.findUnique({
        where: { id: current },
        select: { parentId: true },
      });
      if (!parent) throw new CatalogNotFoundError('Parent category not found');
      current = parent.parentId;
    }
  }

  async listBrands(): Promise<Brand[]> {
    return this.prisma.catalogBrand.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  async findBrandById(id: string): Promise<Brand | null> {
    return this.prisma.catalogBrand.findUnique({ where: { id } });
  }
  async createBrand(
    brand: Brand,
    context?: CatalogMutationContext,
  ): Promise<Brand> {
    return this.retry(() =>
      this.prisma.$transaction(async (tx) => {
        const result = await tx.catalogBrand.create({ data: brand });
        await assertCatalogWrite(tx, context, null);
        await auditCatalog(tx, context, 'BRAND', brand.id, null, result);
        return result;
      }),
    );
  }
  async saveBrand(
    brand: Brand,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<Brand> {
    return this.retry(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "CatalogBrand" SET "version" = "version" WHERE "id" = ${brand.id}`;
        const before = await tx.catalogBrand.findUnique({
          where: { id: brand.id },
        });
        if (!before) throw new CatalogNotFoundError('Brand not found');
        await assertCatalogWrite(tx, context, null);
        const result = await tx.catalogBrand.updateMany({
          where: { id: brand.id, version: expectedVersion },
          data: {
            name: brand.name,
            slug: brand.slug,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new CatalogVersionConflictError();
        const after = await tx.catalogBrand.findUniqueOrThrow({
          where: { id: brand.id },
        });
        await auditCatalog(tx, context, 'BRAND', brand.id, before, after);
        return after;
      }),
    );
  }
  async deleteBrand(
    id: string,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<void> {
    return this.retry(
      () =>
        this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE "CatalogBrand" SET "version" = "version" WHERE "id" = ${id}`;
          const before = await tx.catalogBrand.findUnique({ where: { id } });
          if (!before) throw new CatalogNotFoundError('Brand not found');
          await assertCatalogWrite(tx, context, null);
          if (before.version !== expectedVersion)
            throw new CatalogVersionConflictError();
          const deleted = await tx.catalogBrand.deleteMany({
            where: { id, version: expectedVersion, products: { none: {} } },
          });
          if (deleted.count !== 1)
            throw new CatalogConflictError('Brand is still in use');
          await auditCatalog(tx, context, 'BRAND', id, before, null);
        }),
      true,
    );
  }

  async findProductById(id: string): Promise<ProductSnapshot | null> {
    const row = await this.prisma.catalogProduct.findUnique({
      where: { id },
      include: { variants: { orderBy: { id: 'asc' } } },
    });
    return row ? this.toSnapshot(row) : null;
  }
  async findPublishedProductBySlug(
    slug: string,
  ): Promise<ProductSnapshot | null> {
    const row = await this.prisma.catalogProduct.findUnique({
      where: {
        slug,
        status: 'PUBLISHED',
        OR: [
          { shopId: null },
          {
            shop: {
              status: 'ACTIVE',
              owner: { status: 'ACTIVE', deletedAt: null },
            },
          },
        ],
      },
      include: {
        variants: { where: { isActive: true }, orderBy: { id: 'asc' } },
      },
    });
    return row ? this.toSnapshot(row) : null;
  }
  async listPublishedProducts(
    input: ProductListQuery,
  ): Promise<ProductSummaryPage> {
    const query = normalizeProductQuery(input);
    const where = this.publicWhere(query);
    const [rows, totals] = await this.prisma.$transaction([
      this.prisma.$queryRaw<SummaryRow[]>(
        Prisma.sql`${this.summarySelect()} WHERE ${where} ORDER BY ${this.publicOrder(query)} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) AS "total" FROM "CatalogProduct" p WHERE ${where}`,
      ),
    ]);
    return {
      items: rows.map((row) => this.summary(row)),
      total: Number(totals[0].total),
    };
  }
  async browsePublishedProducts(
    input: CatalogBrowseQuery,
  ): Promise<CatalogBrowsePage> {
    const query = normalizeCatalogBrowseQuery(input);
    const where = [this.publicWhere({ ...query, page: 1 })];
    if (query.cursor) {
      const cursor = decodeCatalogCursor(query.cursor, query);
      where.push(
        Prisma.sql`(p."createdAt" < ${cursor.createdAt} OR (p."createdAt" = ${cursor.createdAt} AND p."id" < ${cursor.id}))`,
      );
    }
    const rows = await this.prisma.$queryRaw<SummaryRow[]>(
      Prisma.sql`${this.summarySelect()} WHERE ${Prisma.join(where, ' AND ')} ORDER BY p."createdAt" DESC, p."id" DESC LIMIT ${query.limit + 1}`,
    );
    const hasNext = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((row) => this.summary(row));
    const last = items.at(-1);
    return {
      items,
      hasNext,
      nextCursor: hasNext && last ? encodeCatalogCursor(last, query) : null,
    };
  }
  private summarySelect(): Prisma.Sql {
    return Prisma.sql`SELECT p."id", p."categoryId", p."shopId", p."brandId", p."name", p."slug", json_extract(p."images", '$[0]') AS "coverImage", p."minPriceAmount", p."createdAt", p."updatedAt", p."publishedAt" FROM "CatalogProduct" p`;
  }
  private publicOrder(query: ProductListQuery): Prisma.Sql {
    if (query.sort === 'price-asc')
      return Prisma.sql`p."minPriceAmount" ASC NULLS LAST, p."createdAt" DESC, p."id" DESC`;
    if (query.sort === 'price-desc')
      return Prisma.sql`p."minPriceAmount" DESC NULLS LAST, p."createdAt" DESC, p."id" DESC`;
    if (query.sort === 'name-asc') return Prisma.sql`p."name" ASC, p."id" DESC`;
    return Prisma.sql`p."createdAt" DESC, p."id" DESC`;
  }
  private publicWhere(query: ProductListQuery): Prisma.Sql {
    const clauses = [
      Prisma.sql`p."status" = 'PUBLISHED'`,
      Prisma.sql`(p."shopId" IS NULL OR EXISTS (SELECT 1 FROM "Shop" s JOIN "User" u ON u."id" = s."ownerId" WHERE s."id" = p."shopId" AND s."status" = 'ACTIVE' AND u."status" = 'ACTIVE' AND u."deletedAt" IS NULL))`,
    ];
    if (query.categoryId)
      clauses.push(Prisma.sql`p."categoryId" = ${query.categoryId}`);
    if (query.brandId) clauses.push(Prisma.sql`p."brandId" = ${query.brandId}`);
    if (query.shopId) clauses.push(Prisma.sql`p."shopId" = ${query.shopId}`);
    if (query.minPrice !== undefined)
      clauses.push(Prisma.sql`p."minPriceAmount" >= ${query.minPrice}`);
    if (query.maxPrice !== undefined)
      clauses.push(Prisma.sql`p."minPriceAmount" <= ${query.maxPrice}`);
    if (query.q) {
      const literal = normalizeCatalogSearch(query.q).replace(
        /[\\%_]/g,
        (char) => '\\' + char,
      );
      clauses.push(
        Prisma.sql`p."searchText" LIKE ${'%' + literal + '%'} ESCAPE '\\'`,
      );
    }
    const attributes = Object.entries(query.attributes ?? {});
    if (attributes.length) {
      const tests = attributes.map(
        ([key, value]) =>
          Prisma.sql`EXISTS (SELECT 1 FROM json_each(v."attributes") a WHERE a."key" = ${key} AND a."value" = ${value})`,
      );
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "CatalogVariant" v WHERE v."productId" = p."id" AND v."isActive" = true AND ${Prisma.join(tests, ' AND ')})`,
      );
    }
    return Prisma.join(clauses, ' AND ');
  }
  private summary(row: SummaryRow): ProductSummary {
    const raw =
      typeof row.coverImage === 'string'
        ? (JSON.parse(row.coverImage) as Prisma.JsonValue)
        : row.coverImage;
    return {
      id: row.id,
      categoryId: row.categoryId,
      shopId: row.shopId,
      brandId: row.brandId,
      name: row.name,
      slug: row.slug,
      coverImage:
        raw == null ? null : this.persistedImages([raw] as Prisma.JsonValue)[0],
      priceFromAmount: row.minPriceAmount,
      currency: 'VND',
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      publishedAt: row.publishedAt === null ? null : new Date(row.publishedAt),
    };
  }

  async listAdminProducts(input: AdminProductListQuery): Promise<ProductPage> {
    const query = normalizeProductQuery(input);
    const attributes = Object.entries(query.attributes ?? {});
    const where: Prisma.CatalogProductWhereInput = {
      categoryId: query.categoryId,
      brandId: query.brandId,
      shopId: query.shopId,
      status: query.status,
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? { minPriceAmount: { gte: query.minPrice, lte: query.maxPrice } }
        : {}),
      ...(query.q
        ? { searchText: { contains: normalizeCatalogSearch(query.q) } }
        : {}),
      ...(attributes.length
        ? {
            variants: {
              some: {
                isActive: true,
                AND: attributes.map(([key, value]) => ({
                  attributes: {
                    path: '$.' + JSON.stringify(key),
                    equals: value,
                  },
                })),
              },
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.catalogProduct.findMany({
        where,
        include: { variants: { orderBy: { id: 'asc' } } },
        orderBy: this.productOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.catalogProduct.count({ where }),
    ]);
    return { items: rows.map((row) => this.toSnapshot(row)), total };
  }
  async createProduct(
    product: ProductSnapshot,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.retry(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "CatalogCategory" SET "version" = "version" WHERE "id" = ${product.categoryId}`;
        await assertCatalogWrite(tx, context, product.shopId ?? null);
        await this.validateCategory(tx, product);
        const { variants, images, ...details } = product;
        const row = await tx.catalogProduct.create({
          data: {
            ...details,
            shopId: product.shopId ?? null,
            brandId: product.brandId ?? null,
            searchText: this.searchText(product),
            images: catalogJson(images),
            minPriceAmount: this.startingPrice(variants),
            variants: {
              create: variants.map(
                ({ attributes, images: variantImages, ...variant }) => ({
                  ...variant,
                  attributes: catalogJson(attributes),
                  images: catalogJson(variantImages ?? []),
                }),
              ),
            },
          },
          include: { variants: { orderBy: { id: 'asc' } } },
        });
        await syncCatalogMedia(tx, product);
        const result = this.toSnapshot(row);
        await auditCatalog(
          tx,
          context,
          'PRODUCT',
          row.id,
          null,
          result,
          product.shopId,
        );
        return result;
      }),
    );
  }
  async saveProduct(
    product: ProductSnapshot,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return this.retry(() =>
      this.prisma.$transaction((tx) =>
        this.persistProductInTransaction(tx, product, expectedVersion, context),
      ),
    );
  }
  /** A caller that owns an approval transaction can commit the claim, aggregate,
   * media references and audit record together without opening a nested tx. */
  async persistProductInTransaction(
    tx: Prisma.TransactionClient,
    product: ProductSnapshot,
    expectedVersion: number,
    context?: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    // Obtain the SQLite write lock before reading the audit baseline or relations.
    await tx.$executeRaw`UPDATE "CatalogProduct" SET "version" = "version" WHERE "id" = ${product.id}`;
    const before = await tx.catalogProduct.findUnique({
      where: { id: product.id },
      include: { variants: { orderBy: { id: 'asc' } } },
    });
    if (!before) throw new CatalogNotFoundError('Product not found');
    if (before.version !== expectedVersion)
      throw new CatalogVersionConflictError();
    if ((product.shopId ?? null) !== before.shopId)
      throw new CatalogConflictError('Product shop cannot be changed');
    await assertCatalogWrite(tx, context, before.shopId);
    if (context && context.actor.role !== 'ADMIN' && context.shopId) {
      if (
        await tx.catalogReview.count({
          where: { productId: product.id, status: 'PENDING' },
        })
      )
        throw new CatalogConflictError(
          'Withdraw the pending review before changing this product',
        );
      if (
        before.status === 'PUBLISHED' &&
        !['SELLER_ARCHIVE_PRODUCT', 'SELLER_UNPUBLISH_PRODUCT'].includes(
          context.action,
        )
      )
        throw new CatalogConflictError(
          'Published product edits require moderation',
        );
    }
    await this.validateCategory(tx, product);
    const changed = await tx.catalogProduct.updateMany({
      where: { id: product.id, version: expectedVersion },
      data: {
        categoryId: product.categoryId,
        brandId: product.brandId ?? null,
        name: product.name,
        slug: product.slug,
        description: product.description,
        images: catalogJson(product.images),
        searchText: this.searchText(product),
        minPriceAmount: this.startingPrice(product.variants),
        status: product.status,
        publishedAt: product.publishedAt,
        updatedAt: product.updatedAt,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new CatalogVersionConflictError();
    const supplied = new Set(product.variants.map((variant) => variant.id));
    if (
      supplied.size !== product.variants.length ||
      before.variants.some((variant) => !supplied.has(variant.id))
    )
      throw new CatalogConflictError(
        'Deactivate variants instead of dropping their identifiers',
      );
    const existing = new Map(
      before.variants.map((variant) => [variant.id, variant]),
    );
    const added = product.variants.filter(
      (variant) => !existing.has(variant.id),
    );
    if (
      added.length &&
      (await tx.catalogVariant.count({
        where: { id: { in: added.map((variant) => variant.id) } },
      }))
    )
      throw new CatalogConflictError('Variant belongs to another product');
    for (const variant of product.variants) {
      const previous = existing.get(variant.id);
      if (previous && previous.sku !== variant.sku)
        throw new CatalogConflictError('Variant SKU is immutable');
      const next = {
        sku: variant.sku,
        name: variant.name,
        priceAmount: variant.priceAmount,
        currency: variant.currency,
        isActive: variant.isActive,
        attributes: catalogJson(variant.attributes),
        images: catalogJson(variant.images ?? []),
      };
      if (!previous)
        await tx.catalogVariant.create({
          data: { id: variant.id, productId: product.id, ...next },
        });
      else if (
        previous.name !== next.name ||
        previous.priceAmount !== next.priceAmount ||
        previous.isActive !== next.isActive ||
        JSON.stringify(previous.attributes) !==
          JSON.stringify(next.attributes) ||
        JSON.stringify(previous.images) !== JSON.stringify(next.images)
      )
        await tx.catalogVariant.update({
          where: { id: variant.id, productId: product.id },
          data: next,
        });
    }
    await syncCatalogMedia(tx, product);
    const staleReviews = await tx.catalogReview.findMany({
      where: { productId: product.id, status: { in: ['DRAFT', 'PENDING'] } },
      select: { id: true },
    });
    if (staleReviews.length) {
      await tx.catalogReview.updateMany({
        where: {
          id: { in: staleReviews.map((row) => row.id) },
          status: { in: ['DRAFT', 'PENDING'] },
        },
        data: {
          status: 'REJECTED',
          note: 'PRODUCT_CHANGED',
          version: { increment: 1 },
        },
      });
      await tx.mediaUsage.deleteMany({
        where: {
          kind: 'CATALOG_REVIEW',
          resourceId: { in: staleReviews.map((row) => row.id) },
        },
      });
    }
    const result = this.toSnapshot(
      await tx.catalogProduct.findUniqueOrThrow({
        where: { id: product.id },
        include: { variants: { orderBy: { id: 'asc' } } },
      }),
    );
    await auditCatalog(
      tx,
      context,
      'PRODUCT',
      product.id,
      this.toSnapshot(before),
      result,
      before.shopId,
    );
    return result;
  }
  private async validateCategory(
    tx: Prisma.TransactionClient,
    product: ProductSnapshot,
  ): Promise<void> {
    const category = await tx.catalogCategory.findUnique({
      where: { id: product.categoryId },
    });
    if (!category) throw new CatalogNotFoundError('Category not found');
    validateVariantsForCategory(this.category(category), product.variants);
  }
  private category(row: CategoryRow): Category {
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
  private searchText(product: ProductSnapshot): string {
    return normalizeCatalogSearch(
      [product.name, product.slug, product.description].join(' '),
    );
  }
  private toSnapshot(row: PersistedProduct): ProductSnapshot {
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
      images: this.persistedImages(row.images),
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
          attributes: this.persistedAttributes(variant.attributes),
          images: this.persistedImages(variant.images),
        };
      }),
    };
  }
  private persistedImages(value: Prisma.JsonValue): ProductSnapshot['images'] {
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
  private persistedAttributes(value: Prisma.JsonValue): Record<string, string> {
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
  private startingPrice(variants: ProductVariant[]): number | null {
    const prices = variants
      .filter((variant) => variant.isActive)
      .map((variant) => variant.priceAmount);
    return prices.length ? Math.min(...prices) : null;
  }
  private productOrder(
    query: AdminProductListQuery,
  ): Prisma.CatalogProductOrderByWithRelationInput[] {
    if (query.sort === 'price-asc' || query.sort === 'price-desc')
      return [
        {
          minPriceAmount: {
            sort: query.sort === 'price-asc' ? 'asc' : 'desc',
            nulls: 'last',
          },
        },
        { createdAt: 'desc' },
        { id: 'desc' },
      ];
    if (query.sort === 'name-asc') return [{ name: 'asc' }, { id: 'desc' }];
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
  private async retry<T>(
    operation: () => Promise<T>,
    deleting = false,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (this.isSqliteContention(error)) {
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
  private isSqliteContention(error: unknown): boolean {
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
}
