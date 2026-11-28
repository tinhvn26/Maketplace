import type { InventoryReservations } from '../../../inventory/contracts/inventory.api.js';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
  type ShopAccess,
} from '../../../shops/contracts/shops.api.js';
import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  shipOrder,
  type Order,
} from '../../domain/entities/order.js';
import { OrderAccessDeniedError } from '../../domain/errors/order.errors.js';
import {
  cancelReason,
  orderPaging,
  orderStatus,
} from '../../domain/policies/order-input.policy.js';
import type {
  OrderAccessReader,
  OrderActor,
  OrderUnitOfWork,
} from '../ports/order-unit-of-work.js';
import {
  toOrderPage,
  toOrderView,
  type OrderPage,
  type OrderView,
} from '../shared/order-view.js';
import {
  findVisible,
  releaseForCancel,
  requireActiveAccount,
  transition,
} from '../shared/order-transition.js';

/** A seller works on one shop's orders; an administrator on every order, platform ones included. */
export type FulfilmentScope =
  { kind: 'shop'; shopId: string } | { kind: 'admin' };

export class OrderFulfilmentService {
  constructor(
    private readonly unitOfWork: OrderUnitOfWork,
    private readonly shops: ShopAccess,
    private readonly reservations: InventoryReservations,
    private readonly clock: { now(): Date },
  ) {}

  async list(
    scope: FulfilmentScope,
    actor: OrderActor,
    query: {
      status?: unknown;
      shopId?: string | null;
      buyerId?: string;
      page?: unknown;
      limit?: unknown;
    },
  ): Promise<OrderPage> {
    await this.authorize(scope, actor);
    const { page, limit } = orderPaging(query.page, query.limit);
    const status =
      query.status === undefined ? undefined : orderStatus(query.status);
    // Only an administrator filters by shop and buyer; a seller sees their shop.
    const filter =
      scope.kind === 'shop'
        ? { shopId: scope.shopId }
        : { shopId: query.shopId, buyerId: query.buyerId };
    const result = await this.unitOfWork.read((tx) =>
      tx.orders.list({ ...filter, status, page, limit }),
    );
    return toOrderPage(result, page, limit);
  }

  async get(
    scope: FulfilmentScope,
    id: string,
    actor: OrderActor,
  ): Promise<OrderView> {
    await this.authorize(scope, actor);
    return toOrderView(
      await findVisible(this.unitOfWork, id, (o) => inScope(scope, o)),
    );
  }

  confirm(
    scope: FulfilmentScope,
    id: string,
    input: { version: number },
    actor: OrderActor,
  ): Promise<OrderView> {
    return this.change(scope, id, input.version, actor, {
      next: confirmOrder,
      inventory: (order) => this.reservations.confirm(order.reservationId),
    });
  }

  ship(
    scope: FulfilmentScope,
    id: string,
    input: { version: number },
    actor: OrderActor,
  ): Promise<OrderView> {
    return this.change(scope, id, input.version, actor, {
      next: shipOrder,
      inventory: async (order) => {
        const { allocations } = await this.reservations.get(
          order.reservationId,
        );
        const pending = new Set(
          allocations.filter((a) => !a.shipped).map((a) => a.warehouseId),
        );
        for (const warehouseId of pending)
          await this.reservations.ship(order.reservationId, warehouseId);
      },
    });
  }

  deliver(
    scope: FulfilmentScope,
    id: string,
    input: { version: number },
    actor: OrderActor,
  ): Promise<OrderView> {
    return this.change(scope, id, input.version, actor, {
      next: deliverOrder,
      inventory: async () => undefined,
    });
  }

  async cancel(
    scope: FulfilmentScope,
    id: string,
    input: { version: number; reason: string },
    actor: OrderActor,
  ): Promise<OrderView> {
    const by =
      scope.kind === 'shop' && actor.role !== 'ADMIN' ? 'SELLER' : 'ADMIN';
    return this.change(scope, id, input.version, actor, {
      // Validated here, after authorization, so a caller without access gets 403/404 rather than 400.
      next: (order, now) =>
        cancelOrder(order, by, cancelReason(input.reason, true), now),
      inventory: (order) =>
        releaseForCancel(this.reservations, order.reservationId),
    });
  }

  private async change(
    scope: FulfilmentScope,
    id: string,
    version: number,
    actor: OrderActor,
    steps: {
      next: (order: Order, now: Date) => Order;
      inventory: (order: Order) => Promise<unknown>;
    },
  ): Promise<OrderView> {
    await this.authorize(scope, actor);
    const now = this.clock.now();
    return transition(this.unitOfWork, id, version, {
      visible: (order) => inScope(scope, order),
      next: (order) => steps.next(order, now),
      inventory: steps.inventory,
      recheck: (access) => recheck(access, scope, actor),
    });
  }

  private async authorize(scope: FulfilmentScope, actor: OrderActor) {
    if (scope.kind === 'shop')
      await this.shops.requireManageable(scope.shopId, actor);
    else if (actor.role !== 'ADMIN') throw new OrderAccessDeniedError();
  }
}

function inScope(scope: FulfilmentScope, order: Order) {
  return scope.kind === 'admin' || order.shopId === scope.shopId;
}

/** `authorize` again inside the write transaction, which holds the write lock,
 * so the shop or account cannot change before the commit. */
async function recheck(
  access: OrderAccessReader,
  scope: FulfilmentScope,
  actor: OrderActor,
): Promise<void> {
  await requireActiveAccount(access, actor);
  if (scope.kind === 'admin') {
    if (actor.role !== 'ADMIN') throw new OrderAccessDeniedError();
    return;
  }
  const shop = await access.findShopState(scope.shopId);
  if (!shop) throw new ShopNotFoundError();
  if (actor.role !== 'ADMIN' && shop.ownerId !== actor.userId)
    throw new ShopAccessDeniedError();
  if (!shop.sellable) throw new ShopUnavailableError();
}
