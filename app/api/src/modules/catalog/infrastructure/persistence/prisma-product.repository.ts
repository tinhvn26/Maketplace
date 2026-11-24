import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import { Prisma } from '../../../../platform/database/generated/client.js';
import type {
  ProductSnapshot,
  ProductVariant,
} from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import { validateVariantsForCategory } from '../../domain/policies/category-attributes.policy.js';
import { normalizeCatalogSearch } from '../../domain/policies/catalog-search.policy.js';
import type {
  AdminProductListQuery,
  ProductListQuery,
  ProductPage,
  ProductSummary,
  ProductSummaryPage,
  CatalogBrowseQuery,
  CatalogBrowsePage,
} from '../../application/ports/catalog.repository.js';
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
import {
  sellableShopIdsSql,
  sellableShopWhere,
} from '../../../shops/contracts/shops.persistence.js';
import { releaseMediaUsages } from '../../../media/contracts/media.persistence.js';
import {
  persistedImages,
  retryCatalogWrite,
  toCategory,
  toProductSnapshot,
} from './catalog-persistence.shared.js';

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
export class PrismaProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProductById(id: string): Promise<ProductSnapshot | null> {
    const row = await this.prisma.catalogProduct.findUnique({
      where: { id },
      include: { variants: { orderBy: { id: 'asc' } } },
    });
    return row ? toProductSnapshot(row) : null;
  }
  async findPublishedProductBySlug(
    slug: string,
  ): Promise<ProductSnapshot | null> {
    const row = await this.prisma.catalogProduct.findUnique({
      where: {
        slug,
        status: 'PUBLISHED',
        OR: [{ shopId: null }, { shop: sellableShopWhere }],
      },
      include: {
        variants: { where: { isActive: true }, orderBy: { id: 'asc' } },
      },
    });
    return row ? toProductSnapshot(row) : null;
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
      Prisma.sql`(p."shopId" IS NULL OR p."shopId" IN (${sellableShopIdsSql()}))`,
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
        raw == null ? null : persistedImages([raw] as Prisma.JsonValue)[0],
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
    return { items: rows.map((row) => toProductSnapshot(row)), total };
  }
  async createProduct(
    product: ProductSnapshot,
    context: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return retryCatalogWrite(() =>
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
        const result = toProductSnapshot(row);
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
    context: CatalogMutationContext,
  ): Promise<ProductSnapshot> {
    return retryCatalogWrite(() =>
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
    context: CatalogMutationContext,
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
      await releaseMediaUsages(
        tx,
        'CATALOG_REVIEW',
        staleReviews.map((row) => row.id),
      );
    }
    const result = toProductSnapshot(
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
      toProductSnapshot(before),
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
    validateVariantsForCategory(toCategory(category), product.variants);
  }
  private searchText(product: ProductSnapshot): string {
    return normalizeCatalogSearch(
      [product.name, product.slug, product.description].join(' '),
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
}
