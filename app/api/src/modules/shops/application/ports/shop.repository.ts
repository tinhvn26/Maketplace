import type { ShopActor, ShopAccess } from '../../contracts/shops.api.js';
import type { Shop } from '../../domain/entities/shop.js';

export const SHOP_REPOSITORY = Symbol('SHOP_REPOSITORY');

export interface ShopRepository extends ShopAccess {
  create(shop: Shop, actor: ShopActor): Promise<Shop>;
  listMine(actor: ShopActor): Promise<Shop[]>;
  findPublicById(id: string): Promise<Shop | null>;
  findById(id: string): Promise<Shop | null>;
  requireAdministrator(actor: ShopActor): Promise<void>;
  save(shop: Shop, expectedVersion: number, actor: ShopActor): Promise<Shop>;
  saveStatus(
    shop: Shop,
    expectedVersion: number,
    actor: ShopActor,
  ): Promise<Shop>;
}
