export const SHOP_ACCESS = Symbol('SHOP_ACCESS');

export interface ShopActor {
  userId: string;
  role: 'USER' | 'ADMIN';
}

export interface ShopAccess {
  requireManageable(shopId: string, actor: ShopActor): Promise<void>;
  assertSellable(shopIds: readonly string[]): Promise<void>;
}

export {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
} from '../domain/errors/shop.errors.js';
