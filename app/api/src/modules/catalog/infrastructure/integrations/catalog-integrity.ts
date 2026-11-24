import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import { findActiveAccount } from '../../../identity/contracts/identity.persistence.js';
import { bindMediaUsages } from '../../../media/contracts/media.persistence.js';
import { findShopState } from '../../../shops/contracts/shops.persistence.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import type { ProductSnapshot } from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
} from '../../domain/errors/catalog.errors.js';

/** Cross-module checks at the infrastructure boundary of the monolith. Identity,
 * Shops and Media own their tables; Catalog reaches them only through their
 * `contracts/*.persistence.ts`, inside the catalog transaction. That transaction
 * owns SQLite's write lock, so a shop cannot be suspended or an asset deleted
 * between these checks and the catalog commit.
 */
export async function assertCatalogWrite(
  tx: Prisma.TransactionClient,
  context: CatalogMutationContext,
  shopId?: string | null,
): Promise<void> {
  const { actor } = context;
  if (!(await findActiveAccount(tx, actor)))
    throw new CatalogNotFoundError('Catalog actor is unavailable');
  if (context.shopId !== undefined && context.shopId !== shopId)
    throw new CatalogNotFoundError('Product not found in this shop');
  if (actor.role !== 'ADMIN' && !context.shopId)
    throw new CatalogNotFoundError('A shop scope is required');
  if (shopId) {
    const shop = await findShopState(tx, shopId);
    if (
      !shop?.sellable ||
      (actor.role !== 'ADMIN' && shop.ownerId !== actor.userId)
    )
      throw new CatalogNotFoundError('Shop is unavailable');
  }
}

export async function syncCatalogMedia(
  tx: Prisma.TransactionClient,
  product: ProductSnapshot,
  kind = 'CATALOG_PRODUCT',
  resourceId = product.id,
): Promise<void> {
  const images = [
    ...product.images,
    ...product.variants.flatMap((variant) => variant.images ?? []),
  ];
  const bound = await bindMediaUsages(tx, {
    assetIds: images.flatMap((image) => (image.assetId ? [image.assetId] : [])),
    shopId: product.shopId ?? null,
    kind,
    resourceId,
  });
  if (!bound)
    throw new CatalogConflictError(
      'A referenced image is unavailable or belongs to another shop',
    );
}

export function catalogJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function auditCatalog(
  tx: Prisma.TransactionClient,
  context: CatalogMutationContext,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  shopId?: string | null,
): Promise<void> {
  await tx.catalogAudit.create({
    data: {
      id: randomUUID(),
      actorId: context.actor.userId,
      action: context.action,
      entityType,
      entityId,
      shopId: shopId ?? null,
      ...(before == null ? {} : { before: catalogJson(before) }),
      ...(after == null ? {} : { after: catalogJson(after) }),
    },
  });
}
