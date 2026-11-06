import type { ShopActor } from '../contracts/shops.api.js';
import {
  assertShopVersion,
  changeShopStatus,
  createShop,
  shopId,
  updateShop,
} from '../domain/entities/shop.js';
import type { Shop, ShopStatus } from '../domain/entities/shop.js';
import {
  ShopNotFoundError,
  ShopVersionConflictError,
} from '../domain/errors/shop.errors.js';
import type { ShopRepository } from './ports/shop.repository.js';

export class ShopsService {
  constructor(
    private readonly shops: ShopRepository,
    private readonly ids: { next(): string },
    private readonly clock: { now(): Date },
  ) {}

  create(
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
    return this.shops.create(shop, actor);
  }

  listMine(actor: ShopActor): Promise<Shop[]> {
    return this.shops.listMine(actor);
  }

  async getPublic(id: string) {
    const shop = await this.shops.findPublicById(shopId(id));
    if (!shop) throw new ShopNotFoundError();
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
    id = shopId(id);
    await this.shops.requireManageable(id, actor);
    const current = await this.current(id, input.version);
    const candidate = updateShop(
      current,
      { name: input.name, slug: input.slug },
      this.clock.now(),
    );
    return this.shops.save(candidate, input.version, actor);
  }

  async setStatus(
    id: string,
    input: { version: number; status: ShopStatus },
    actor: ShopActor,
  ): Promise<Shop> {
    assertShopVersion(input.version);
    await this.shops.requireAdministrator(actor);
    const current = await this.current(shopId(id), input.version);
    const candidate = changeShopStatus(current, input.status, this.clock.now());
    return this.shops.saveStatus(candidate, input.version, actor);
  }

  private async current(id: string, expectedVersion: number): Promise<Shop> {
    const shop = await this.shops.findById(id);
    if (!shop) throw new ShopNotFoundError();
    if (shop.version !== expectedVersion) throw new ShopVersionConflictError();
    return shop;
  }
}
