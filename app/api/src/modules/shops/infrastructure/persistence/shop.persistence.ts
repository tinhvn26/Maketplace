import { Prisma } from '../../../../platform/database/generated/client.js';
import type { Shop as PrismaShop } from '../../../../platform/database/generated/client.js';
import {
  activeAccountIdsSql,
  activeAccountWhere,
} from '../../../identity/contracts/identity.persistence.js';
import type { Shop } from '../../domain/entities/shop.js';
import { isSellableShop } from '../../domain/policies/shop-access.policy.js';
import type { ShopWithOwnerState } from '../../application/ports/shop.repository.js';

type Database = Prisma.TransactionClient;

/** `isSellableShop` as a Prisma filter, for list queries that page in SQL. */
export const sellableShopWhere = {
  status: 'ACTIVE',
  owner: activeAccountWhere,
} satisfies Prisma.ShopWhereInput;

/** `isSellableShop` for raw SQL: `... IN (${sellableShopIdsSql()})`. */
export function sellableShopIdsSql(): Prisma.Sql {
  return Prisma.sql`SELECT s."id" FROM "Shop" s WHERE s."status" = 'ACTIVE' AND s."ownerId" IN (${activeAccountIdsSql()})`;
}

export function toShop(shop: PrismaShop): Shop {
  if (shop.status !== 'ACTIVE' && shop.status !== 'SUSPENDED')
    throw new Error('Unsupported persisted shop status');
  return { ...shop, status: shop.status };
}

export async function findShopsWithOwnerState(
  db: Database,
  ids: readonly string[],
): Promise<ShopWithOwnerState[]> {
  if (ids.length === 0) return [];
  const shops = await db.shop.findMany({ where: { id: { in: [...ids] } } });
  const owners = await db.user.findMany({
    where: {
      id: { in: [...new Set(shops.map((shop) => shop.ownerId))] },
      ...activeAccountWhere,
    },
    select: { id: true },
  });
  const active = new Set(owners.map((owner) => owner.id));
  return shops.map((shop) => ({
    shop: toShop(shop),
    ownerActive: active.has(shop.ownerId),
  }));
}

/** For other modules' write transactions: who owns the shop and whether it can trade. */
export async function findShopState(
  db: Database,
  shopId: string,
): Promise<{ ownerId: string; sellable: boolean } | null> {
  const [found] = await findShopsWithOwnerState(db, [shopId]);
  return found
    ? {
        ownerId: found.shop.ownerId,
        sellable: isSellableShop(found.shop, found.ownerActive),
      }
    : null;
}
