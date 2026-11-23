import type { ShopAccess, ShopActor } from '../../../shops/contracts/shops.api.js';
import { InventoryAccessDeniedError } from '../../domain/errors/inventory.errors.js';

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
