import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import type { Category } from '../../domain/entities/category.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import {
  normalizeCategoryAttributeDefinitions,
  validateVariantsForCategory,
} from '../../domain/policies/category-attributes.policy.js';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import {
  assertCatalogWrite,
  auditCatalog,
  catalogJson,
} from '../integrations/catalog-integrity.js';
import {
  persistedAttributes,
  retryCatalogWrite,
  toCategory,
} from './catalog-persistence.shared.js';

@Injectable()
export class PrismaCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<Category[]> {
    return (
      await this.prisma.catalogCategory.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })
    ).map((row) => toCategory(row));
  }
  async findCategoryById(id: string): Promise<Category | null> {
    const row = await this.prisma.catalogCategory.findUnique({ where: { id } });
    return row ? toCategory(row) : null;
  }
  async createCategory(
    category: Category,
    context: CatalogMutationContext,
  ): Promise<Category> {
    return retryCatalogWrite(() =>
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
        const result = toCategory(row);
        await auditCatalog(tx, context, 'CATEGORY', row.id, null, result);
        return result;
      }),
    );
  }
  async saveCategory(
    category: Category,
    expectedVersion: number,
    context: CatalogMutationContext,
  ): Promise<Category> {
    return retryCatalogWrite(() =>
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
              attributes: persistedAttributes(row.attributes),
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
        const result = toCategory(
          await tx.catalogCategory.findUniqueOrThrow({
            where: { id: category.id },
          }),
        );
        await auditCatalog(
          tx,
          context,
          'CATEGORY',
          category.id,
          toCategory(before),
          result,
        );
        return result;
      }),
    );
  }
  async deleteCategory(
    id: string,
    expectedVersion: number,
    context: CatalogMutationContext,
  ): Promise<void> {
    return retryCatalogWrite(
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
            toCategory(before),
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
}
