import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogValidationError,
  CatalogVersionConflictError,
  type CatalogQuoteRequest,
} from '../src/modules/catalog/contracts/catalog-pricing.api.js';
import {
  IdempotencyConflictError,
  InsufficientStockError,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryValidationError,
  ReservationStateError,
} from '../src/modules/inventory/contracts/inventory.api.js';
import { InventoryVersionConflictError } from '../src/modules/inventory/domain/errors/inventory.errors.js';
import {
  OrderCheckoutService,
  type PlaceOrderInput,
} from '../src/modules/orders/application/checkout/order-checkout.service.js';
import { translateExternal } from '../src/modules/orders/application/shared/external-errors.js';
import {
  OrderAccessDeniedError,
  OrderIdempotencyConflictError,
  OrderItemUnavailableError,
  OrderOutOfStockError,
  OrderPriceChangedError,
  OrderStockExpiredError,
  OrderValidationError,
  OrderVersionConflictError,
} from '../src/modules/orders/domain/errors/order.errors.js';
import { FakeReservations } from './support/fake-reservations.js';
import { InMemoryOrders } from './support/in-memory-orders.js';

const now = new Date('2026-11-28T00:00:00.000Z');
const buyer = { userId: 'buyer-1', role: 'CUSTOMER' as const };
const catalog: Record<
  string,
  { shopId: string | null; price: number; version: number }
> = {
  v1: { shopId: 's1', price: 100, version: 1 },
  v2: { shopId: 's1', price: 200, version: 2 },
  v3: { shopId: 's2', price: 300, version: 3 },
  vp: { shopId: null, price: 400, version: 4 },
};

async function quoteImpl({ lines }: CatalogQuoteRequest) {
  const quoted = lines.map(({ variantId, quantity }) => {
    const item = catalog[variantId];
    return {
      variantId,
      productId: `p-${variantId}`,
      shopId: item.shopId,
      productName: `Product ${variantId}`,
      variantName: `Variant ${variantId}`,
      sku: `SKU-${variantId}`,
      quantity,
      unitPriceAmount: item.price,
      lineTotalAmount: item.price * quantity,
      currency: 'VND' as const,
      productVersion: item.version,
    };
  });
  return {
    lines: quoted,
    totalAmount: quoted.reduce((sum, line) => sum + line.lineTotalAmount, 0),
    currency: 'VND' as const,
    quotedAt: now,
  };
}

describe('OrderCheckoutService', () => {
  let store: InMemoryOrders;
  let reservations: FakeReservations;
  let quote: ReturnType<typeof vi.fn<typeof quoteImpl>>;
  let sequence: number;
  let service: OrderCheckoutService;

  const serviceFor = (orders: InMemoryOrders) =>
    new OrderCheckoutService(
      orders,
      { quote },
      reservations,
      { next: () => `id-${++sequence}` },
      { now: () => now },
    );

  const input = (quantity = 2): PlaceOrderInput => ({
    idempotencyKey: 'checkout-key-1',
    lines: [
      { variantId: 'v1', quantity, expectedUnitPriceAmount: 100 },
      { variantId: 'v3', quantity: 1 },
      { variantId: 'v2', quantity: 1 },
      { variantId: 'vp', quantity: 1 },
    ],
    shippingAddress: {
      recipientName: ' Nguyễn Văn An ',
      phoneNumber: '0912345678',
      addressLine: '12 Lê Lợi, Q1, TP.HCM',
    },
    note: 'Giao giờ hành chính',
  });

  const statuses = () =>
    [...reservations.reservations.values()].map((r) => r.status);
  const orderStatuses = () => [...store.orders.values()].map((o) => o.status);

  /** Places a checkout through another store so `adopt()` can make it look committed by a parallel request. */
  async function rivalCheckout(request = input()) {
    const rival = new InMemoryOrders();
    const winner = await serviceFor(rival).place(request, buyer);
    const adopt = () => {
      for (const [id, checkout] of rival.checkouts)
        store.checkouts.set(id, checkout);
      for (const [id, order] of rival.orders) store.orders.set(id, order);
    };
    return { winner, adopt, holds: new Set(reservations.reservations.keys()) };
  }

  function failConfirmAt(call: number) {
    const confirm = reservations.confirm.bind(reservations);
    let confirms = 0;
    reservations.confirm = async (id) => {
      if (++confirms === call) throw new ReservationStateError();
      return confirm(id);
    };
  }

  beforeEach(() => {
    sequence = 0;
    store = new InMemoryOrders();
    reservations = new FakeReservations();
    quote = vi.fn(quoteImpl);
    service = serviceFor(store);
  });

  it('splits one checkout into one order per seller', async () => {
    const result = await service.place(input(), buyer);

    expect(result.created).toBe(true);
    expect(result.orders.map((o) => o.shopId)).toEqual(['s1', 's2', null]);
    expect(result.orders[0]).toMatchObject({
      checkoutId: result.checkoutId,
      buyerId: 'buyer-1',
      status: 'PLACED',
      subtotalAmount: 400,
      note: 'Giao giờ hành chính',
      shippingAddress: { recipientName: 'Nguyễn Văn An' },
      version: 0,
    });
    expect(result.orders[0].lines.map((l) => l.variantId)).toEqual([
      'v1',
      'v2',
    ]);
    expect(result.orders[0]).not.toHaveProperty('reservationId');
    expect(result.orders[0].lines[0]).not.toHaveProperty('productVersion');
    expect(statuses()).toEqual(['ALLOCATED', 'ALLOCATED', 'ALLOCATED']);
    expect(store.orders.size).toBe(3);
    expect(reservations.calls[0]).toBe(`reserve:${result.orders[0].id}`);

    const [first, second] = quote.mock.calls.map(([request]) => request.lines);
    expect(first[0]).toEqual({
      variantId: 'v1',
      quantity: 2,
      expectedUnitPriceAmount: 100,
    });
    expect(first[1]).not.toHaveProperty('expectedUnitPriceAmount');
    expect(second[1]).toEqual({
      variantId: 'v3',
      quantity: 1,
      expectedUnitPriceAmount: 300,
      expectedProductVersion: 3,
    });
  });

  it('replays the same request without holding stock again', async () => {
    const first = await service.place(input(), buyer);
    const again = await service.place(input(), buyer);

    expect(again.created).toBe(false);
    expect(again.checkoutId).toBe(first.checkoutId);
    expect(again.orders.map((o) => o.id)).toEqual(
      first.orders.map((o) => o.id),
    );
    expect(
      reservations.calls.filter((call) => call.startsWith('reserve:')),
    ).toHaveLength(3);
  });

  it('rejects the same key with a different body', async () => {
    await service.place(input(), buyer);
    await expect(service.place(input(3), buyer)).rejects.toThrow(
      OrderIdempotencyConflictError,
    );
  });

  it('rejects a changed price before holding stock', async () => {
    quote.mockRejectedValueOnce(new CatalogConflictError());
    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderPriceChangedError,
    );
    expect(reservations.calls).toEqual([]);
  });

  it('releases earlier holds when a later seller is out of stock', async () => {
    reservations.failReserveFor.add('v3');
    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderOutOfStockError,
    );
    const [held] = [...reservations.reservations.keys()];
    expect(reservations.calls).toContain(`release:${held}`);
    expect(statuses()).toEqual(['RELEASED']);
    expect(store.orders.size).toBe(0);
    expect(store.checkouts.size).toBe(0);
  });

  it('releases its holds when the second quote finds a change', async () => {
    quote
      .mockImplementationOnce(quoteImpl)
      .mockRejectedValueOnce(new CatalogNotFoundError());
    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderItemUnavailableError,
    );
    expect(statuses()).toEqual(['RELEASED', 'RELEASED', 'RELEASED']);
    expect(store.orders.size).toBe(0);
  });

  it('releases its holds when a concurrent checkout with the same key won', async () => {
    const { winner, adopt, holds } = await rivalCheckout();
    store.beforeNextRun = adopt;

    const result = await service.place(input(), buyer);

    expect(result.created).toBe(false);
    expect(result.checkoutId).toBe(winner.checkoutId);
    expect(result.orders).toEqual(winner.orders);
    for (const [id, reservation] of reservations.reservations)
      expect(reservation.status).toBe(holds.has(id) ? 'ALLOCATED' : 'RELEASED');
    expect(store.orders.size).toBe(3);
  });

  it('rejects a concurrent loser whose winner sent a different body, releasing its holds', async () => {
    const { adopt, holds } = await rivalCheckout(input(3));
    store.beforeNextRun = adopt;

    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderIdempotencyConflictError,
    );
    for (const [id, reservation] of reservations.reservations)
      expect(reservation.status).toBe(holds.has(id) ? 'ALLOCATED' : 'RELEASED');
  });

  it('replays a double submit that ran out of stock because the first submit holds it', async () => {
    const { winner, adopt, holds } = await rivalCheckout();
    reservations.failReserveFor.add('v3');
    const reserve = reservations.reserve.bind(reservations);
    reservations.reserve = async (request) => {
      adopt(); // the first submit commits after this request's pre-check
      return reserve(request);
    };

    const result = await service.place(input(), buyer);

    expect(result).toMatchObject({
      created: false,
      checkoutId: winner.checkoutId,
    });
    expect(result.orders).toEqual(winner.orders);
    for (const [id, reservation] of reservations.reservations)
      expect(reservation.status).toBe(holds.has(id) ? 'ALLOCATED' : 'RELEASED');
  });

  it('cancels every order of the checkout when a hold cannot be confirmed', async () => {
    failConfirmAt(2);

    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderOutOfStockError,
    );
    const orders = [...store.orders.values()];
    expect(orders).toHaveLength(3);
    for (const order of orders)
      expect(order).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: 'SYSTEM',
        cancelReason: 'Không giữ được hàng',
        version: 1,
      });
    expect(statuses()).toEqual(['RELEASED', 'RELEASED', 'RELEASED']);
  });

  it('replays the cancelled orders when the buyer retries a failed checkout', async () => {
    failConfirmAt(2);
    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderOutOfStockError,
    );

    const retry = await service.place(input(), buyer);

    expect(retry.created).toBe(false);
    expect(retry.checkoutId).toBe([...store.checkouts.keys()][0]);
    expect(retry.orders.map((o) => o.status)).toEqual([
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
    ]);
  });

  it('keeps cancelling the other orders when one cancel cannot be saved', async () => {
    failConfirmAt(2);
    const run = store.run.bind(store);
    let runs = 0;
    // Run 1 inserts the checkout; runs 2-4 cancel the orders one by one.
    store.run = ((work) =>
      ++runs === 3
        ? Promise.reject(new Error('database is locked'))
        : run(work)) as typeof store.run;

    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderOutOfStockError,
    );
    expect(orderStatuses()).toEqual(['CANCELLED', 'PLACED', 'CANCELLED']);
    expect(statuses()).toEqual(['RELEASED', 'RELEASED', 'RELEASED']);
  });

  it('leaves an order PLACED when its hold cannot be released', async () => {
    failConfirmAt(2);
    const release = reservations.release.bind(reservations);
    reservations.release = async (id) => {
      if (id === 'r2') throw new Error('inventory is down');
      return release(id);
    };

    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderOutOfStockError,
    );
    expect(orderStatuses()).toEqual(['CANCELLED', 'PLACED', 'CANCELLED']);
    expect(statuses()).toEqual(['RELEASED', 'ACTIVE', 'RELEASED']);
  });

  it('refuses an inactive buyer', async () => {
    store.inactiveUsers.add(buyer.userId);
    await expect(service.place(input(), buyer)).rejects.toThrow(
      OrderAccessDeniedError,
    );
    expect(statuses()).toEqual(['RELEASED', 'RELEASED', 'RELEASED']);
    expect(store.orders.size).toBe(0);
  });
});

describe('translateExternal', () => {
  it.each([
    [new CatalogConflictError(), OrderPriceChangedError],
    [new CatalogNotFoundError(), OrderItemUnavailableError],
    [new CatalogValidationError(), OrderValidationError],
    [new InventoryValidationError(), OrderValidationError],
    [new InsufficientStockError(), OrderOutOfStockError],
    [new ReservationStateError(), OrderStockExpiredError],
    [new CatalogVersionConflictError(), OrderVersionConflictError],
    [new InventoryVersionConflictError(), OrderVersionConflictError],
    [new IdempotencyConflictError(), OrderVersionConflictError],
    [new InventoryConflictError(), OrderVersionConflictError],
    [new InventoryNotFoundError(), OrderStockExpiredError],
  ])('turns %o into an order error', (error, expected) => {
    expect(() => translateExternal(error)).toThrow(expected);
  });

  it('rethrows anything else unchanged', () => {
    const error = new Error('boom');
    expect(() => translateExternal(error)).toThrow(error);
  });
});
