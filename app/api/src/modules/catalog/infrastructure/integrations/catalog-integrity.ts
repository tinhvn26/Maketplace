import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import type { CatalogMutationContext } from '../../application/ports/catalog-actor.js';
import type { ProductSnapshot } from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
} from '../../domain/errors/catalog.errors.js';

/** Shared-database integration at the infrastructure boundary of the monolith.
 * The transaction owns SQLite's write lock before these checks; a shop cannot
 * be suspended or an asset deleted between this check and the catalog commit.
 */
export async function assertCatalogWrite(
  tx: Prisma.TransactionClient,
  context: CatalogMutationContext | undefined,
  shopId?: string | null,
): Promise<void> {
  if (!context) return; // Trusted legacy internal callers; HTTP always supplies an actor.
  const actor = await tx.user.findFirst({
    where: { id: context.actor.userId, status: 'ACTIVE', deletedAt: null },
    select: { role: true },
  });
  if (
    !actor ||
    actor.role !== context.actor.role ||
    !['ADMIN', 'EMPLOYER', 'CUSTOMER'].includes(actor.role)
  )
    throw new CatalogNotFoundError('Catalog actor is unavailable');
  if (context.shopId !== undefined && context.shopId !== shopId)
    throw new CatalogNotFoundError('Product not found in this shop');
  if (context.actor.role !== 'ADMIN' && !context.shopId)
    throw new CatalogNotFoundError('A shop scope is required');
  if (shopId) {
    const shop = await tx.shop.findFirst({
      where: {
        id: shopId,
        status: 'ACTIVE',
        owner: { status: 'ACTIVE', deletedAt: null },
        ...(context.actor.role === 'ADMIN'
          ? {}
          : { ownerId: context.actor.userId }),
      },
    });
    if (!shop) throw new CatalogNotFoundError('Shop is unavailable');
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
  const ids = [
    ...new Set(
      images.flatMap((image) => (image.assetId ? [image.assetId] : [])),
    ),
  ];
  if (ids.length) {
    const assets = await tx.mediaAsset.findMany({
      where: {
        id: { in: ids },
        status: 'READY',
        shopId: product.shopId ?? null,
      },
      select: { id: true },
    });
    if (assets.length !== ids.length)
      throw new CatalogConflictError(
        'A referenced image is unavailable or belongs to another shop',
      );
  }
  await tx.mediaUsage.deleteMany({ where: { kind, resourceId } });
  if (ids.length)
    await tx.mediaUsage.createMany({
      data: ids.map((assetId) => ({ assetId, kind, resourceId })),
    });
}

export function catalogJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function auditCatalog(
  tx: Prisma.TransactionClient,
  context: CatalogMutationContext | undefined,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  shopId?: string | null,
): Promise<void> {
  await tx.catalogAudit.create({
    data: {
      id: randomUUID(),
      actorId: context?.actor.userId ?? null,
      action: context?.action ?? 'SYSTEM_MUTATION',
      entityType,
      entityId,
      shopId: shopId ?? null,
      ...(before == null ? {} : { before: catalogJson(before) }),
      ...(after == null ? {} : { after: catalogJson(after) }),
    },
  });
}
