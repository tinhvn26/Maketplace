import { describe, expect, it } from 'vitest';
import { OrderStateError } from '../errors/order.errors.js';
import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  placeOrder,
  shipOrder,
  type OrderLine,
} from './order.js';

const now = new Date('2026-11-28T10:00:00.000Z');
const later = new Date('2026-11-28T11:00:00.000Z');
const line = (quantity: number, unit: number): OrderLine => ({
  variantId: `v${unit}`,
  productId: 'p1',
  productName: 'Ao',
  variantName: 'M',
  sku: `SKU${unit}`,
  quantity,
  unitPriceAmount: unit,
  lineTotalAmount: quantity * unit,
  productVersion: 1,
});
const placed = () =>
  placeOrder({
    id: 'o1',
    checkoutId: 'c1',
    buyerId: 'b1',
    shopId: 's1',
    reservationId: 'r1',
    lines: [line(2, 150000), line(1, 5000)],
    shippingAddress: {
      recipientName: 'An',
      phoneNumber: '0912345678',
      addressLine: '1 Le Loi',
    },
    note: null,
    now,
  });

describe('order entity', () => {
  it('places an order with the line total as subtotal', () => {
    const order = placed();
    expect(order.subtotalAmount).toBe(305000);
    expect(order.status).toBe('PLACED');
    expect(order.version).toBe(0);
    expect(order.confirmedAt).toBeNull();
    expect(order.shippedAt).toBeNull();
    expect(order.deliveredAt).toBeNull();
    expect(order.cancelledAt).toBeNull();
  });

  it('walks the happy path', () => {
    const confirmed = confirmOrder(placed(), later);
    const shipped = shipOrder(confirmed, later);
    const delivered = deliverOrder(shipped, later);
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.confirmedAt).toEqual(later);
    expect(delivered.shippedAt).toEqual(later);
    expect(delivered.deliveredAt).toEqual(later);
    expect(delivered.version).toBe(0);
  });

  it('repeating a transition is a no-op', () => {
    const confirmed = confirmOrder(placed(), later);
    expect(confirmOrder(confirmed, later)).toBe(confirmed);
    const cancelled = cancelOrder(placed(), 'BUYER', null, later);
    expect(cancelOrder(cancelled, 'BUYER', null, later)).toBe(cancelled);
  });

  it('rejects invalid transitions', () => {
    const order = placed();
    const confirmed = confirmOrder(order, later);
    const shipped = shipOrder(confirmed, later);
    const cancelled = cancelOrder(order, 'BUYER', null, later);
    expect(() => shipOrder(order, later)).toThrow(OrderStateError);
    expect(() => deliverOrder(confirmed, later)).toThrow(OrderStateError);
    expect(() => cancelOrder(shipped, 'SELLER', null, later)).toThrow(
      OrderStateError,
    );
    expect(() => confirmOrder(cancelled, later)).toThrow(OrderStateError);
  });

  it('lets only sellers and admins cancel a confirmed order', () => {
    const confirmed = confirmOrder(placed(), later);
    expect(() => cancelOrder(confirmed, 'BUYER', null, later)).toThrow(
      OrderStateError,
    );
    const cancelled = cancelOrder(confirmed, 'SELLER', 'out of stock', later);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledBy).toBe('SELLER');
    expect(cancelled.cancelReason).toBe('out of stock');
  });
});
