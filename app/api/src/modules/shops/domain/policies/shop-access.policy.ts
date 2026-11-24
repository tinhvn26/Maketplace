import type { UserRole } from '../../../identity/contracts/identity.roles.js';
import type { ShopStatus } from '../entities/shop.js';

/** An account Identity has confirmed is active and holds `role` right now. */
export interface ShopAccount {
  id: string;
  role: UserRole;
}

export function mayManageShop(ownerId: string, account: ShopAccount): boolean {
  return account.role === 'ADMIN' || ownerId === account.id;
}

/** Kept in sync with `sellableShopWhere`/`sellableShopIdsSql` used for list queries. */
export function isSellableShop(
  shop: { status: ShopStatus },
  ownerActive: boolean,
): boolean {
  return shop.status === 'ACTIVE' && ownerActive;
}
