import type { ShopAccess, ShopActor } from '../contracts/shops.api.js';
import {
  assertShopVersion,
  changeShopStatus,
  createShop,
  shopId,
  updateShop,
} from '../domain/entities/shop.js';
import type { Shop, ShopStatus } from '../domain/entities/shop.js';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
  ShopVersionConflictError,
} from '../domain/errors/shop.errors.js';
import {
  isSellableShop,
  mayManageShop,
} from '../domain/policies/shop-access.policy.js';
import type { ShopAccount } from '../domain/policies/shop-access.policy.js';
import type { ShopRepository, ShopStore } from './ports/shop.repository.js';

export class ShopsService implements ShopAccess {
  constructor(
    private readonly shops: ShopRepository,
    private readonly ids: { next(): string },
    private readonly clock: { now(): Date },
  ) {}

  async create(
    input: { name: string; slug: string },
    actor: ShopActor,
  ): Promise<Shop> {
    const shop = createShop({
      id: this.ids.next(),
      ownerId: actor.userId,
      name: input.name,
      slug: input.slug,
      now: this.clock.now(),
    });
    return this.shops.transaction(actor.userId, async (store) => {
      await this.account(store, actor);
      return store.insert(shop);
    });
  }

  async listMine(actor: ShopActor): Promise<Shop[]> {
    const account = await this.account(this.shops, actor);
    return this.shops.listByOwner(account.id);
  }

  async getPublic(id: string) {
    const found = await this.shops.findWithOwnerState(shopId(id));
    if (!found || !isSellableShop(found.shop, found.ownerActive))
      throw new ShopNotFoundError();
    const { shop } = found;
    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      createdAt: new Date(shop.createdAt),
      updatedAt: new Date(shop.updatedAt),
    };
  }

  async update(
    id: string,
    input: { version: number; name?: string; slug?: string },
    actor: ShopActor,
  ): Promise<Shop> {
    assertShopVersion(input.version);
    const key = shopId(id);
    return this.shops.transaction(actor.userId, async (store) => {
      const current = await this.manageable(store, key, actor);
      if (current.version !== input.version)
        throw new ShopVersionConflictError();
      const candidate = updateShop(
        current,
        { name: input.name, slug: input.slug },
        this.clock.now(),
      );
      return store.save(candidate, input.version);
    });
  }

  async setStatus(
    id: string,
    input: { version: number; status: ShopStatus },
    actor: ShopActor,
  ): Promise<Shop> {
    assertShopVersion(input.version);
    const key = shopId(id);
    return this.shops.transaction(actor.userId, async (store) => {
      const account = await this.account(store, actor);
      if (account.role !== 'ADMIN')
        throw new ShopAccessDeniedError('Administrator access is required');
      const current = await store.findById(key);
      if (!current) throw new ShopNotFoundError();
      if (current.version !== input.version)
        throw new ShopVersionConflictError();
      const candidate = changeShopStatus(
        current,
        input.status,
        this.clock.now(),
      );
      return store.saveStatus(candidate, input.version);
    });
  }

  async requireManageable(id: string, actor: ShopActor): Promise<void> {
    await this.manageable(this.shops, shopId(id), actor);
  }

  async assertSellable(ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids.map(shopId))];
    if (unique.length === 0) return;
    const found = await this.shops.findManyWithOwnerState(unique);
    const sellable = found.filter((item) =>
      isSellableShop(item.shop, item.ownerActive),
    );
    if (sellable.length !== unique.length) throw new ShopUnavailableError();
  }

  private async account(
    store: ShopStore,
    actor: ShopActor,
  ): Promise<ShopAccount> {
    const account = await store.findActiveAccount({
      userId: shopId(actor.userId),
      role: actor.role,
    });
    if (!account) throw new ShopAccessDeniedError();
    return account;
  }

  private async manageable(
    store: ShopStore,
    id: string,
    actor: ShopActor,
  ): Promise<Shop> {
    const account = await this.account(store, actor);
    const found = await store.findWithOwnerState(id);
    if (!found) throw new ShopNotFoundError();
    if (!mayManageShop(found.shop.ownerId, account))
      throw new ShopAccessDeniedError();
    if (!isSellableShop(found.shop, found.ownerActive))
      throw new ShopUnavailableError();
    return found.shop;
  }
}
