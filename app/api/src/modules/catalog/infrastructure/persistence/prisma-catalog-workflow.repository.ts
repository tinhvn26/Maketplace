import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CatalogReview,
  Prisma,
} from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import type {
  CatalogWorkflowRepository,
  SellerProductState,
} from '../../application/ports/catalog-workflow.repository.js';
import { Product } from '../../domain/entities/product.js';
import type { ProductSnapshot } from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogValidationError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import {
  assertCatalogWrite,
  auditCatalog,
  catalogJson,
  syncCatalogMedia,
} from '../integrations/catalog-integrity.js';
import { releaseMediaUsages } from '../../../media/contracts/media.persistence.js';
import { PrismaCatalogRepository } from './prisma-catalog.repository.js';
import {
  normalizeCategoryAttributeDefinitions,
  validateVariantsForCategory,
} from '../../domain/policies/category-attributes.policy.js';

@Injectable()
export class PrismaCatalogWorkflowRepository implements CatalogWorkflowRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PrismaCatalogRepository,
  ) {}

  async load(
    productId: string,
    shopId: string,
  ): Promise<SellerProductState | null> {
    const product = await this.catalog.findProductById(productId);
    if (!product || product.shopId !== shopId) return null;
    const revision = await this.prisma.catalogReview.findFirst({
      where: { productId, status: { in: ['DRAFT', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
    });
    return { product, revision: revision ? this.revision(revision) : null };
  }

  async saveRevision(
    product: ProductSnapshot,
    expectedVersion: number,
    revisionVersion: number | undefined,
    context: CatalogMutationContext,
  ) {
    await this.catalog.runInTransaction(async (tx) => {
      await this.claimProduct(tx, product.id, expectedVersion, context);
      await this.validateCategory(tx, product);
      const current = await this.active(tx, product.id);
      if (current?.status === 'PENDING')
        throw new CatalogConflictError(
          'Withdraw the pending review before editing',
        );
      this.assertRevision(current, revisionVersion);
      const id = current?.id ?? randomUUID();
      await syncCatalogMedia(tx, product, 'CATALOG_REVIEW', id);
      const data = { snapshot: catalogJson(product), updatedAt: new Date() };
      const saved = current
        ? await tx.catalogReview.update({
            where: { id: current.id },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.catalogReview.create({
            data: {
              ...data,
              id,
              productId: product.id,
              baseVersion: expectedVersion,
              status: 'DRAFT',
              version: 0,
            },
          });
      await auditCatalog(
        tx,
        context,
        'REVIEW',
        id,
        current,
        saved,
        context.shopId,
      );
    });
    return (await this.load(product.id, context.shopId!))!;
  }

  async submit(
    productId: string,
    version: number,
    revisionVersion: number | undefined,
    context: CatalogMutationContext,
  ) {
    await this.catalog.runInTransaction(async (tx) => {
      await this.claimProduct(tx, productId, version, context);
      const current = await this.active(tx, productId);
      if (current?.status === 'PENDING')
        throw new CatalogConflictError('Product is already awaiting review');
      this.assertRevision(current, revisionVersion);
      const live = await this.snapshot(tx, productId);
      if (live.status === 'ARCHIVED')
        throw new CatalogConflictError('Archived products cannot be submitted');
      const candidate = Product.restore(
        current ? this.decode(current.snapshot) : live,
      );
      if (candidate.toSnapshot().status === 'DRAFT')
        candidate.publish(new Date());
      const proposal = candidate.toSnapshot();
      await this.validateCategory(tx, proposal);
      // Persistence performs schema validation again on approval as definitions may change.
      const id = current?.id ?? randomUUID();
      await syncCatalogMedia(tx, proposal, 'CATALOG_REVIEW', id);
      const data = {
        status: 'PENDING',
        snapshot: catalogJson(proposal),
        submittedBy: context.actor.userId,
        updatedAt: new Date(),
      };
      const saved = current
        ? await tx.catalogReview.update({
            where: { id },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.catalogReview.create({
            data: { ...data, id, productId, baseVersion: version, version: 0 },
          });
      await auditCatalog(
        tx,
        context,
        'REVIEW',
        id,
        current,
        saved,
        context.shopId,
      );
    });
    return (await this.load(productId, context.shopId!))!;
  }

  async withdraw(
    productId: string,
    version: number,
    revisionVersion: number,
    context: CatalogMutationContext,
  ) {
    await this.catalog.runInTransaction(async (tx) => {
      await this.claimProduct(tx, productId, version, context);
      const current = await this.active(tx, productId);
      this.assertRevision(current, revisionVersion);
      if (!current) throw new CatalogNotFoundError('Review not found');
      if (current.status !== 'PENDING')
        throw new CatalogConflictError('Only pending reviews can be withdrawn');
      const live = await this.snapshot(tx, productId);
      const proposal = Product.restore(this.decode(current.snapshot));
      if (
        live.status === 'DRAFT' &&
        proposal.toSnapshot().status === 'PUBLISHED'
      )
        proposal.unpublish(new Date());
      const saved = await tx.catalogReview.update({
        where: { id: current.id },
        data: {
          status: 'DRAFT',
          snapshot: catalogJson(proposal.toSnapshot()),
          version: { increment: 1 },
          note: 'WITHDRAWN',
          updatedAt: new Date(),
        },
      });
      await auditCatalog(
        tx,
        context,
        'REVIEW',
        current.id,
        current,
        saved,
        context.shopId,
      );
    });
    return (await this.load(productId, context.shopId!))!;
  }

  async review(
    id: string,
    version: number,
    approve: boolean,
    note: string | undefined,
    context: CatalogMutationContext,
  ) {
    if (context.actor.role !== 'ADMIN')
      throw new CatalogNotFoundError('Review not found');
    if (
      !Number.isInteger(version) ||
      version < 0 ||
      (note !== undefined && (typeof note !== 'string' || note.length > 1000))
    )
      throw new CatalogValidationError('Invalid review version or note');
    return this.catalog.runInTransaction(async (tx) => {
      // Claim the decision before reading its payload; concurrent decisions have one winner.
      const claimed = await tx.catalogReview.updateMany({
        where: { id, version, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          version: { increment: 1 },
          reviewedBy: context.actor.userId,
          note: note?.trim() || null,
          updatedAt: new Date(),
        },
      });
      if (claimed.count !== 1)
        throw new CatalogVersionConflictError(
          'Review changed or has already been decided',
        );
      const saved = await tx.catalogReview.findUniqueOrThrow({ where: { id } });
      const product = this.decode(saved.snapshot);
      await assertCatalogWrite(tx, context, product.shopId);
      if (approve)
        await this.catalog.persistProductInTransaction(
          tx,
          product,
          saved.baseVersion,
          { ...context, action: 'APPROVE_PRODUCT' },
        );
      await releaseMediaUsages(tx, 'CATALOG_REVIEW', [id]);
      await auditCatalog(
        tx,
        context,
        'REVIEW',
        id,
        { status: 'PENDING', version },
        saved,
        product.shopId,
      );
      return this.revision(saved);
    });
  }

  async listReviews(
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    limit: number,
  ) {
    if (
      !['PENDING', 'APPROVED', 'REJECTED'].includes(status) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new CatalogValidationError('Invalid review query');
    return (
      await this.prisma.catalogReview.findMany({
        where: { status },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
    ).map((row) => this.revision(row));
  }
  async audit(entityId: string, limit: number) {
    if (!entityId || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new CatalogValidationError('Invalid audit query');
    return this.prisma.catalogAudit.findMany({
      where: { entityId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  private async claimProduct(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    context: CatalogMutationContext,
  ) {
    if (
      !Number.isInteger(version) ||
      version < 0 ||
      version > 2147483646 ||
      !context.shopId
    )
      throw new CatalogValidationError(
        'A shop scope and valid version are required',
      );
    const claimed =
      await tx.$executeRaw`UPDATE "CatalogProduct" SET "version" = "version" WHERE "id" = ${id} AND "version" = ${version} AND "shopId" = ${context.shopId}`;
    if (claimed !== 1) throw new CatalogVersionConflictError();
    await assertCatalogWrite(tx, context, context.shopId);
  }
  private async validateCategory(
    tx: Prisma.TransactionClient,
    product: ProductSnapshot,
  ) {
    const category = await tx.catalogCategory.findUnique({
      where: { id: product.categoryId },
    });
    if (!category) throw new CatalogNotFoundError('Category not found');
    validateVariantsForCategory(
      {
        attributeDefinitions: normalizeCategoryAttributeDefinitions(
          category.attributeDefinitions,
        ),
      },
      product.variants,
    );
    if (
      product.brandId &&
      !(await tx.catalogBrand.findUnique({ where: { id: product.brandId } }))
    )
      throw new CatalogNotFoundError('Brand not found');
  }
  private active(tx: Prisma.TransactionClient, productId: string) {
    return tx.catalogReview.findFirst({
      where: { productId, status: { in: ['DRAFT', 'PENDING'] } },
    });
  }
  private assertRevision(
    current: CatalogReview | null,
    version: number | undefined,
  ) {
    if (current ? current.version !== version : version !== undefined)
      throw new CatalogVersionConflictError(
        'Revision changed; reload it before editing',
      );
  }
  private async snapshot(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<ProductSnapshot> {
    const row = await tx.catalogProduct.findUniqueOrThrow({
      where: { id },
      include: { variants: true },
    });
    return Product.restore({
      ...row,
      status: row.status as ProductSnapshot['status'],
      images: row.images as unknown as ProductSnapshot['images'],
      variants: row.variants.map((variant) => ({
        ...variant,
        currency: 'VND',
        attributes: variant.attributes as Record<string, string>,
        images: variant.images as unknown as ProductSnapshot['images'],
      })),
    }).toSnapshot();
  }
  private decode(value: Prisma.JsonValue): ProductSnapshot {
    const snapshot = value as unknown as ProductSnapshot;
    return Product.restore({
      ...snapshot,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
      publishedAt:
        snapshot.publishedAt === null ? null : new Date(snapshot.publishedAt),
    }).toSnapshot();
  }
  private revision(row: CatalogReview) {
    return {
      ...row,
      status: row.status as 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED',
      snapshot: this.decode(row.snapshot),
    };
  }
}
