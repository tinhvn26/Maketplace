import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import type { Brand } from '../../domain/entities/brand.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import {
  assertCatalogWrite,
  auditCatalog,
} from '../integrations/catalog-integrity.js';
import { retryCatalogWrite } from './catalog-persistence.shared.js';

@Injectable()
export class PrismaBrandRepository {
  constructor(private readonly prisma: PrismaService) {}

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
    context: CatalogMutationContext,
  ): Promise<Brand> {
    return retryCatalogWrite(() =>
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
    context: CatalogMutationContext,
  ): Promise<Brand> {
    return retryCatalogWrite(() =>
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
    context: CatalogMutationContext,
  ): Promise<void> {
    return retryCatalogWrite(
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
}
