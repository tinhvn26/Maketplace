import type { Prisma } from '../../../../platform/database/generated/client.js';

type Database = Prisma.TransactionClient;

/** Replaces the assets a resource uses. Returns false, writing nothing, when an
 * asset is missing, deleted or belongs to another shop. Runs in the caller's
 * transaction, which serializes it with `deleteUnused`. */
export async function bindMediaUsages(
  tx: Database,
  input: {
    assetIds: readonly string[];
    shopId: string | null;
    kind: string;
    resourceId: string;
  },
): Promise<boolean> {
  const ids = [...new Set(input.assetIds)];
  if (ids.length) {
    const ready = await tx.mediaAsset.count({
      where: { id: { in: ids }, status: 'READY', shopId: input.shopId },
    });
    if (ready !== ids.length) return false;
  }
  await releaseMediaUsages(tx, input.kind, [input.resourceId]);
  if (ids.length)
    await tx.mediaUsage.createMany({
      data: ids.map((assetId) => ({
        assetId,
        kind: input.kind,
        resourceId: input.resourceId,
      })),
    });
  return true;
}

export async function releaseMediaUsages(
  tx: Database,
  kind: string,
  resourceIds: readonly string[],
): Promise<void> {
  if (resourceIds.length)
    await tx.mediaUsage.deleteMany({
      where: { kind, resourceId: { in: [...resourceIds] } },
    });
}
