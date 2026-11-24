import type { ShopActor } from '../../contracts/shops.api.js';
import type { Shop } from '../../domain/entities/shop.js';
import type { ShopAccount } from '../../domain/policies/shop-access.policy.js';

export const SHOP_REPOSITORY = Symbol('SHOP_REPOSITORY');

export interface ShopWithOwnerState {
  shop: Shop;
  ownerActive: boolean;
}

/** Data access only; every access decision is made in ShopsService. */
export interface ShopStore {
  findActiveAccount(actor: ShopActor): Promise<ShopAccount | null>;
  findById(id: string): Promise<Shop | null>;
  findWithOwnerState(id: string): Promise<ShopWithOwnerState | null>;
  findManyWithOwnerState(ids: readonly string[]): Promise<ShopWithOwnerState[]>;
  listByOwner(ownerId: string): Promise<Shop[]>;
  insert(shop: Shop): Promise<Shop>;
  /** Compare-and-set on `version`; writes name, slug and updatedAt. */
  save(shop: Shop, expectedVersion: number): Promise<Shop>;
  /** Compare-and-set on `version`; writes status and updatedAt. */
  saveStatus(shop: Shop, expectedVersion: number): Promise<Shop>;
}

export interface ShopRepository extends ShopStore {
  /** Runs `work` in one write transaction that first locks the actor's
   * account, so its checks cannot go stale before the commit. */
  transaction<T>(
    actorId: string,
    work: (store: ShopStore) => Promise<T>,
  ): Promise<T>;
}
