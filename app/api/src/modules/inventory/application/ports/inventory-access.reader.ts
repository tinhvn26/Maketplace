import type { ShopActor } from '../../../shops/contracts/shops.api.js';

/** Account and shop state read inside the inventory write transaction, so a
 * suspension or role change cannot land between the check and the commit. */
export interface InventoryAccessReader {
  /** Active and still holding `actor.role`. */
  isActiveAccount(actor: ShopActor): Promise<boolean>;
  findShopState(
    shopId: string,
  ): Promise<{ ownerId: string; sellable: boolean } | null>;
}
