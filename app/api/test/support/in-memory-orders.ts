import type {
  OrderCheckoutRecord,
  OrderRepositories,
  OrderUnitOfWork,
} from '../../src/modules/orders/application/ports/order-unit-of-work.js';
import type { Order } from '../../src/modules/orders/domain/entities/order.js';
import {
  OrderConflictError,
  OrderVersionConflictError,
} from '../../src/modules/orders/domain/errors/order.errors.js';

/** In-memory unit of work with real rollback and compare-and-set semantics. */
export class InMemoryOrders implements OrderUnitOfWork {
  checkouts = new Map<string, OrderCheckoutRecord>();
  orders = new Map<string, Order>();
  /** What the write transaction sees of Shops and Identity. */
  shops = new Map<string, { ownerId: string; sellable: boolean }>();
  inactiveUsers = new Set<string>();
  /** One-shot: runs at the start of the next `run()`, simulating a writer that committed just before it. */
  beforeNextRun?: () => void;

  async run<T>(work: (tx: OrderRepositories) => Promise<T>): Promise<T> {
    const hook = this.beforeNextRun;
    this.beforeNextRun = undefined;
    hook?.();
    const before = {
      checkouts: new Map(this.checkouts),
      orders: new Map(this.orders),
    };
    try {
      return await work(this.repositories());
    } catch (error) {
      Object.assign(this, before);
      throw error;
    }
  }

  read<T>(work: (tx: OrderRepositories) => Promise<T>): Promise<T> {
    return work(this.repositories());
  }

  // `state` defaults to this so the object literals below can refer to it without an alias.
  private repositories(state: InMemoryOrders = this): OrderRepositories {
    return {
      orders: {
        async findCheckout(buyerId, idempotencyKey) {
          const checkout = [...state.checkouts.values()].find(
            (c) => c.buyerId === buyerId && c.idempotencyKey === idempotencyKey,
          );
          if (!checkout) return null;
          return {
            checkout,
            orders: [...state.orders.values()]
              .filter((o) => o.checkoutId === checkout.id)
              .sort((a, b) => (a.id < b.id ? -1 : 1)),
          };
        },
        async insertCheckout(checkout, orders) {
          const exists = [...state.checkouts.values()].some(
            (c) =>
              c.buyerId === checkout.buyerId &&
              c.idempotencyKey === checkout.idempotencyKey,
          );
          if (exists) throw new OrderConflictError('Checkout already exists');
          state.checkouts.set(checkout.id, checkout);
          for (const order of orders) state.orders.set(order.id, order);
        },
        async findById(id) {
          return state.orders.get(id) ?? null;
        },
        async list(q) {
          const rows = [...state.orders.values()]
            .filter(
              (o) =>
                (q.buyerId === undefined || o.buyerId === q.buyerId) &&
                (q.shopId === undefined || o.shopId === q.shopId) &&
                (q.status === undefined || o.status === q.status),
            )
            .sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime() ||
                (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
            );
          return {
            items: rows.slice((q.page - 1) * q.limit, q.page * q.limit),
            total: rows.length,
          };
        },
        async save(order, expectedVersion) {
          if (state.orders.get(order.id)?.version !== expectedVersion)
            throw new OrderVersionConflictError();
          const saved = { ...order, version: expectedVersion + 1 };
          state.orders.set(saved.id, saved);
          return saved;
        },
      },
      access: {
        async isActiveAccount(actor) {
          return !state.inactiveUsers.has(actor.userId);
        },
        async findShopState(shopId) {
          return state.shops.get(shopId) ?? null;
        },
      },
    };
  }
}
