import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogQuoteRequest } from '../src/modules/catalog/contracts/catalog-pricing.api.js';
import { OrderBuyerService } from '../src/modules/orders/application/buyer/order-buyer.service.js';
import { OrderCheckoutService } from '../src/modules/orders/application/checkout/order-checkout.service.js';
import {
  OrderFulfilmentService,
  type FulfilmentScope,
} from '../src/modules/orders/application/fulfilment/order-fulfilment.service.js';
import type { OrderActor } from '../src/modules/orders/application/ports/order-unit-of-work.js';
import { confirmOrder } from '../src/modules/orders/domain/entities/order.js';
import {
  OrderAccessDeniedError,
  OrderNotFoundError,
  OrderStateError,
  OrderStockExpiredError,
  OrderValidationError,
  OrderVersionConflictError,
} from '../src/modules/orders/domain/errors/order.errors.js';
import {
  ShopUnavailableError,
  type ShopAccess,
} from '../src/modules/shops/contracts/shops.api.js';
import { FakeReservations } from './support/fake-reservations.js';
import { InMemoryOrders } from './support/in-memory-orders.js';

const now = new Date('2026-11-28T00:00:00.000Z');
const buyer: OrderActor = { userId: 'buyer-1', role: 'CUSTOMER' };
const stranger: OrderActor = { userId: 'buyer-2', role: 'CUSTOMER' };
const seller: OrderActor = { userId: 'seller', role: 'EMPLOYER' };
const other: OrderActor = { userId: 'other', role: 'EMPLOYER' };
const admin: OrderActor = { userId: 'admin', role: 'ADMIN' };
const s1: FulfilmentScope = { kind: 'shop', shopId: 's1' };
const s2: FulfilmentScope = { kind: 'shop', shopId: 's2' };
const platform: FulfilmentScope = { kind: 'admin' };
const catalog: Record<string, string | null> = {
  v1: 's1',
  v2: 's1',
  v3: 's2',
  vp: null,
};

async function quote({ lines }: CatalogQuoteRequest) {
  const quoted = lines.map(({ variantId, quantity }) => ({
    variantId,
    productId: `p-${variantId}`,
    shopId: catalog[variantId],
    productName: `Product ${variantId}`,
    variantName: `Variant ${variantId}`,
    sku: `SKU-${variantId}`,
    quantity,
    unitPriceAmount: 100,
    lineTotalAmount: 100 * quantity,
    currency: 'VND' as const,
    productVersion: 1,
  }));
  return {
    lines: quoted,
    totalAmount: quoted.reduce((sum, line) => sum + line.lineTotalAmount, 0),
    currency: 'VND' as const,
    quotedAt: now,
  };
}

describe('Order buyer and fulfilment services', () => {
  let store: InMemoryOrders;
  let reservations: FakeReservations;
  let shops: {
    requireManageable: ReturnType<
      typeof vi.fn<ShopAccess['requireManageable']>
    >;
    assertSellable: ReturnType<typeof vi.fn<ShopAccess['assertSellable']>>;
  };
  let checkout: OrderCheckoutService;
  let buyers: OrderBuyerService;
  let fulfilment: OrderFulfilmentService;
  let sequence: number;

  /** Places one order through the real checkout and returns it with its reservation id. */
  async function place(variantIds = ['v1'], by = buyer) {
    const result = await checkout.place(
      {
        idempotencyKey: `checkout-${++sequence}`,
        lines: variantIds.map((variantId) => ({ variantId, quantity: 1 })),
        shippingAddress: {
          recipientName: 'Nguyễn Văn An',
          phoneNumber: '0912345678',
          addressLine: '12 Lê Lợi, Q1',
        },
      },
      by,
    );
    const order = result.orders[0];
    return { order, reservationId: store.orders.get(order.id)!.reservationId };
  }

  const reservation = (id: string) => reservations.reservations.get(id)!;

  beforeEach(() => {
    sequence = 0;
    store = new InMemoryOrders();
    store.shops.set('s1', { ownerId: seller.userId, sellable: true });
    store.shops.set('s2', { ownerId: other.userId, sellable: true });
    reservations = new FakeReservations();
    shops = {
      requireManageable: vi.fn<ShopAccess['requireManageable']>(
        async () => undefined,
      ),
      assertSellable: vi.fn<ShopAccess['assertSellable']>(
        async () => undefined,
      ),
    };
    const clock = { now: () => now };
    checkout = new OrderCheckoutService(
      store,
      { quote },
      reservations,
      { next: () => `id-${++sequence}` },
      clock,
    );
    buyers = new OrderBuyerService(store, reservations, clock);
    fulfilment = new OrderFulfilmentService(store, shops, reservations, clock);
  });

  it('lets the buyer list, read and cancel only their own orders', async () => {
    const { order, reservationId } = await place();

    await expect(buyers.get(order.id, stranger)).rejects.toThrow(
      OrderNotFoundError,
    );
    await expect(
      buyers.cancel(order.id, { version: 0 }, stranger),
    ).rejects.toThrow(OrderNotFoundError);
    expect((await buyers.list(stranger, {})).total).toBe(0);
    expect(await buyers.list(buyer, { status: 'PLACED' })).toMatchObject({
      items: [{ id: order.id }],
      total: 1,
      page: 1,
      limit: 20,
      pages: 1,
    });
    expect(await buyers.get(order.id, buyer)).toEqual(order);

    const cancelled = await buyers.cancel(order.id, { version: 0 }, buyer);

    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'BUYER',
      cancelReason: null,
      cancelledAt: now,
      version: 1,
    });
    expect(reservation(reservationId).status).toBe('RELEASED');

    const again = await buyers.cancel(order.id, { version: 1 }, buyer);
    expect(again).toEqual(cancelled);
  });

  it('does not let the buyer cancel a confirmed order', async () => {
    const { order } = await place();
    await fulfilment.confirm(s1, order.id, { version: 0 }, seller);

    await expect(
      buyers.cancel(order.id, { version: 1 }, buyer),
    ).rejects.toThrow(OrderStateError);
  });

  it('walks confirm, ship and deliver for the shop owner', async () => {
    const { order, reservationId } = await place();

    const confirmed = await fulfilment.confirm(
      s1,
      order.id,
      { version: 0 },
      seller,
    );
    const shipped = await fulfilment.ship(s1, order.id, { version: 1 }, seller);
    const delivered = await fulfilment.deliver(
      s1,
      order.id,
      { version: 2 },
      seller,
    );

    expect(confirmed).toMatchObject({ status: 'CONFIRMED', confirmedAt: now });
    expect(shipped).toMatchObject({ status: 'SHIPPED', shippedAt: now });
    expect(delivered).toMatchObject({
      status: 'DELIVERED',
      deliveredAt: now,
      version: 3,
    });
    expect(reservation(reservationId).status).toBe('SHIPPED');
    expect(shops.requireManageable).toHaveBeenCalledWith('s1', seller);
    expect(await fulfilment.get(s1, order.id, seller)).toEqual(delivered);
    expect(
      (await fulfilment.list(s1, seller, { status: 'DELIVERED' })).items,
    ).toEqual([delivered]);
  });

  it('requires a reason when a seller cancels', async () => {
    const { order } = await place();
    await expect(
      fulfilment.cancel(s1, order.id, { version: 0, reason: '' }, seller),
    ).rejects.toThrow(OrderValidationError);

    const cancelled = await fulfilment.cancel(
      s1,
      order.id,
      { version: 0, reason: ' Hết hàng ' },
      seller,
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'SELLER',
      cancelReason: 'Hết hàng',
    });
  });

  it("hides another shop's order as not found", async () => {
    const { order } = await place();
    await place(['v3']);

    await expect(fulfilment.get(s2, order.id, other)).rejects.toThrow(
      OrderNotFoundError,
    );
    await expect(
      fulfilment.confirm(s2, order.id, { version: 0 }, other),
    ).rejects.toThrow(OrderNotFoundError);
    const list = await fulfilment.list(s2, other, { shopId: 's1' });
    expect(list.items.map((o) => o.shopId)).toEqual(['s2']);
  });

  it('rechecks the shop inside the write transaction', async () => {
    const { order } = await place();
    store.beforeNextRun = () =>
      store.shops.set('s1', { ownerId: seller.userId, sellable: false });

    await expect(
      fulfilment.confirm(s1, order.id, { version: 0 }, seller),
    ).rejects.toThrow(ShopUnavailableError);
    expect(store.orders.get(order.id)!.status).toBe('PLACED');
  });

  it('lets an admin handle platform orders and suspended shops', async () => {
    const { order: platformOrder } = await place(['vp']);
    const { order: shopOrder } = await place(['v1']);
    store.shops.set('s1', { ownerId: seller.userId, sellable: false });

    await expect(
      fulfilment.confirm(platform, platformOrder.id, { version: 0 }, seller),
    ).rejects.toThrow(OrderAccessDeniedError);
    expect(
      await fulfilment.confirm(
        platform,
        platformOrder.id,
        { version: 0 },
        admin,
      ),
    ).toMatchObject({ status: 'CONFIRMED', shopId: null });
    expect(
      await fulfilment.cancel(
        platform,
        shopOrder.id,
        { version: 0, reason: 'Shop bị khoá' },
        admin,
      ),
    ).toMatchObject({ status: 'CANCELLED', cancelledBy: 'ADMIN' });
    expect(
      (await fulfilment.list(platform, admin, { shopId: null })).items.map(
        (o) => o.id,
      ),
    ).toEqual([platformOrder.id]);
  });

  it('refuses a write from an account deactivated mid-request', async () => {
    const { order } = await place();
    store.beforeNextRun = () => store.inactiveUsers.add(buyer.userId);

    await expect(
      buyers.cancel(order.id, { version: 0 }, buyer),
    ).rejects.toThrow(OrderAccessDeniedError);
    expect(store.orders.get(order.id)!.status).toBe('PLACED');
  });

  it('retries a partial shipment without shipping twice', async () => {
    reservations.allocate = (variantId) => (variantId === 'v1' ? 'w1' : 'w2');
    const { order, reservationId } = await place(['v1', 'v2']);
    await fulfilment.confirm(s1, order.id, { version: 0 }, seller);
    const ship = reservations.ship.bind(reservations);
    let failed = false;
    reservations.ship = async (id, warehouseId) => {
      if (warehouseId === 'w2' && !failed) {
        failed = true;
        throw new Error('inventory is down');
      }
      return ship(id, warehouseId);
    };

    await expect(
      fulfilment.ship(s1, order.id, { version: 1 }, seller),
    ).rejects.toThrow('inventory is down');
    expect(store.orders.get(order.id)!.status).toBe('CONFIRMED');

    const shipped = await fulfilment.ship(s1, order.id, { version: 1 }, seller);

    expect(shipped.status).toBe('SHIPPED');
    expect(
      reservations.calls.filter((c) => c === `ship:${reservationId}:w1`),
    ).toHaveLength(1);
    expect(reservation(reservationId).status).toBe('SHIPPED');
  });

  it('refuses to cancel once inventory has shipped', async () => {
    const { order, reservationId } = await place();
    await fulfilment.confirm(s1, order.id, { version: 0 }, seller);
    await reservations.ship(reservationId, 'w1');

    await expect(
      fulfilment.cancel(s1, order.id, { version: 1, reason: 'Lỗi' }, seller),
    ).rejects.toThrow(OrderStateError);
    expect(store.orders.get(order.id)!.status).toBe('CONFIRMED');
  });

  it('reports an expired hold when confirming', async () => {
    const { order, reservationId } = await place();
    reservations.reservations.set(reservationId, {
      ...reservation(reservationId),
      status: 'EXPIRED',
    });

    await expect(
      fulfilment.confirm(s1, order.id, { version: 0 }, seller),
    ).rejects.toThrow(OrderStockExpiredError);
  });

  it('still cancels an order whose hold expired', async () => {
    const { order, reservationId } = await place();
    reservations.reservations.set(reservationId, {
      ...reservation(reservationId),
      status: 'EXPIRED',
    });

    expect(await buyers.cancel(order.id, { version: 0 }, buyer)).toMatchObject({
      status: 'CANCELLED',
    });
  });

  it('rejects a stale version', async () => {
    const { order } = await place();
    await expect(
      fulfilment.confirm(s1, order.id, { version: 5 }, seller),
    ).rejects.toThrow(OrderVersionConflictError);
  });

  it('rejects a version that changed before the write transaction', async () => {
    const { order } = await place();
    store.beforeNextRun = () =>
      store.orders.set(order.id, {
        ...store.orders.get(order.id)!,
        version: 1,
      });

    await expect(
      fulfilment.confirm(s1, order.id, { version: 0 }, seller),
    ).rejects.toThrow(OrderVersionConflictError);
  });

  it('refuses to cancel a partly shipped order', async () => {
    reservations.allocate = (variantId) => (variantId === 'v1' ? 'w1' : 'w2');
    const { order, reservationId } = await place(['v1', 'v2']);
    await fulfilment.confirm(s1, order.id, { version: 0 }, seller);
    await reservations.ship(reservationId, 'w1');

    await expect(
      fulfilment.cancel(s1, order.id, { version: 1, reason: 'Lỗi' }, seller),
    ).rejects.toThrow(OrderStateError);
    expect(reservation(reservationId).status).toBe('ALLOCATED');
    expect(reservations.calls).not.toContain(`release:${reservationId}`);
    expect(store.orders.get(order.id)!.status).toBe('CONFIRMED');
  });

  it('refuses a cancel when a shipment lands just before the release', async () => {
    reservations.allocate = (variantId) => (variantId === 'v1' ? 'w1' : 'w2');
    const { order, reservationId } = await place(['v1', 'v2']);
    await fulfilment.confirm(s1, order.id, { version: 0 }, seller);
    const release = reservations.release.bind(reservations);
    reservations.release = async (id, options) => {
      await reservations.ship(id, 'w1');
      return release(id, options);
    };

    await expect(
      fulfilment.cancel(s1, order.id, { version: 1, reason: 'Lỗi' }, seller),
    ).rejects.toThrow(OrderStateError);
    expect(store.orders.get(order.id)!.status).toBe('CONFIRMED');
    expect(reservation(reservationId)).toMatchObject({ status: 'ALLOCATED' });
    expect(
      reservation(reservationId).allocations.map((a) => a.shipped),
    ).toEqual([true, false]);
  });

  it('accepts a confirm that commits between the buyer release and the buyer write', async () => {
    const { order, reservationId } = await place();
    // The seller's confirm commits after the buyer released the hold.
    store.beforeNextRun = () =>
      store.orders.set(order.id, {
        ...confirmOrder(store.orders.get(order.id)!, now),
        version: 1,
      });

    await expect(
      buyers.cancel(order.id, { version: 0 }, buyer),
    ).rejects.toThrow(OrderVersionConflictError);
    expect(store.orders.get(order.id)!.status).toBe('CONFIRMED');
    expect(reservation(reservationId).status).toBe('RELEASED');

    await expect(
      fulfilment.ship(s1, order.id, { version: 1 }, seller),
    ).rejects.toThrow(OrderStockExpiredError);
    expect(
      await fulfilment.cancel(
        s1,
        order.id,
        { version: 1, reason: 'Hết hàng' },
        seller,
      ),
    ).toMatchObject({ status: 'CANCELLED', cancelledBy: 'SELLER' });
  });

  it('answers a repeated action with the current order even with the old version', async () => {
    const { order: first } = await place();
    const cancelled = await buyers.cancel(first.id, { version: 0 }, buyer);
    expect(await buyers.cancel(first.id, { version: 0 }, buyer)).toEqual(
      cancelled,
    );

    const { order: second } = await place();
    const confirmed = await fulfilment.confirm(
      s1,
      second.id,
      { version: 0 },
      seller,
    );
    expect(
      await fulfilment.confirm(s1, second.id, { version: 0 }, seller),
    ).toEqual(confirmed);
  });

  it('answers a double click that lands inside the write transaction', async () => {
    const { order } = await place();
    store.beforeNextRun = () =>
      store.orders.set(order.id, {
        ...confirmOrder(store.orders.get(order.id)!, now),
        version: 1,
      });

    expect(
      await fulfilment.confirm(s1, order.id, { version: 0 }, seller),
    ).toMatchObject({ status: 'CONFIRMED', version: 1 });
  });

  it('checks access before validating the cancel reason', async () => {
    const { order } = await place();
    await expect(
      fulfilment.cancel(platform, order.id, { version: 0, reason: '' }, seller),
    ).rejects.toThrow(OrderAccessDeniedError);
  });

  it('records an admin acting in a shop scope as the canceller', async () => {
    const { order } = await place();
    expect(
      await fulfilment.cancel(
        s1,
        order.id,
        { version: 0, reason: 'Vi phạm' },
        admin,
      ),
    ).toMatchObject({ status: 'CANCELLED', cancelledBy: 'ADMIN' });
  });

  it('lets an admin filter orders by buyer', async () => {
    const { order } = await place();
    await place(['v1'], stranger);

    const list = await fulfilment.list(platform, admin, {
      buyerId: buyer.userId,
    });
    expect(list.items.map((o) => o.id)).toEqual([order.id]);
    expect(list.total).toBe(1);
  });
});
