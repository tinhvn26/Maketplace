import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { CatalogPurchasingReader } from '../../application/ports/catalog-purchasing.reader.js';

@Injectable()
export class PrismaCatalogPurchasingReader implements CatalogPurchasingReader {
  constructor(private readonly prisma: PrismaService) {}

  async findPurchasableVariants(ids: readonly string[]) {
    // Prisma may load related products in a separate statement. Read prices and
    // their product revisions from the same database snapshot.
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.catalogVariant.findMany({
        where: {
          id: { in: [...ids] },
          isActive: true,
          priceAmount: { gt: 0 },
          currency: 'VND',
          product: {
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
        },
        select: {
          id: true,
          name: true,
          sku: true,
          priceAmount: true,
          product: {
            select: { id: true, name: true, shopId: true, version: true },
          },
        },
      });
      return rows.map((row) => ({
        variantId: row.id,
        productId: row.product.id,
        shopId: row.product.shopId,
        productName: row.product.name,
        variantName: row.name,
        sku: row.sku,
        unitPriceAmount: row.priceAmount,
        currency: 'VND' as const,
        productVersion: row.product.version,
      }));
    });
  }
}
