import type {
  ShopAccess,
  ShopActor,
} from '../../../shops/contracts/shops.api.js';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
} from '../../../shops/contracts/shops.api.js';
import { InventoryAccessDeniedError } from '../../domain/errors/inventory.errors.js';
import type { InventoryAccessReader } from '../ports/inventory-access.reader.js';

/** Whose inventory is addressed: one shop's, or the platform's (shopId null). */
export interface InventoryScope {
  shopId: string | null;
}

/** Shop scopes follow shop ownership rules; the platform scope is administrator-only. */
export async function authorizeScope(
  shops: ShopAccess,
  scope: InventoryScope,
  actor: ShopActor,
): Promise<void> {
  if (scope.shopId !== null) {
    await shops.requireManageable(scope.shopId, actor);
    return;
  }
  if (actor.role !== 'ADMIN') throw new InventoryAccessDeniedError();
}

/** `authorizeScope` again inside the write transaction, which holds the write
 * lock, so the shop or account cannot change before the commit. */
export async function recheckScope(
  access: InventoryAccessReader,
  scope: InventoryScope,
  actor: ShopActor,
): Promise<void> {
  if (!(await access.isActiveAccount(actor)))
    throw new InventoryAccessDeniedError(
      'An active account with current privileges is required',
    );
  if (scope.shopId === null) {
    if (actor.role !== 'ADMIN') throw new InventoryAccessDeniedError();
    return;
  }
  const shop = await access.findShopState(scope.shopId);
  if (!shop) throw new ShopNotFoundError();
  if (actor.role !== 'ADMIN' && shop.ownerId !== actor.userId)
    throw new ShopAccessDeniedError();
  if (!shop.sellable) throw new ShopUnavailableError();
}
