import {
  OrderStateError,
  OrderValidationError,
} from '../errors/order.errors.js';

export type OrderStatus =
  'PLACED' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export type OrderCanceller = 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM';

export interface ShippingAddress {
  recipientName: string;
  phoneNumber: string;
  addressLine: string;
}

export interface OrderLine {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  unitPriceAmount: number;
  lineTotalAmount: number;
  productVersion: number;
}

export interface Order {
  id: string;
  checkoutId: string;
  buyerId: string;
  shopId: string | null;
  status: OrderStatus;
  reservationId: string;
  lines: OrderLine[];
  subtotalAmount: number;
  currency: 'VND';
  shippingAddress: ShippingAddress;
  note: string | null;
  cancelReason: string | null;
  cancelledBy: OrderCanceller | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
}

export function placeOrder(input: {
  id: string;
  checkoutId: string;
  buyerId: string;
  shopId: string | null;
  reservationId: string;
  lines: OrderLine[];
  shippingAddress: ShippingAddress;
  note: string | null;
  now: Date;
}): Order {
  const { now, ...rest } = input;
  if (rest.lines.length === 0)
    throw new OrderValidationError('An order requires at least one line');
  return {
    ...rest,
    status: 'PLACED',
    subtotalAmount: rest.lines.reduce(
      (sum, line) => sum + line.lineTotalAmount,
      0,
    ),
    currency: 'VND',
    cancelReason: null,
    cancelledBy: null,
    version: 0,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
  };
}

function advance(
  order: Order,
  from: OrderStatus,
  to: OrderStatus,
  stamp: 'confirmedAt' | 'shippedAt' | 'deliveredAt',
  now: Date,
): Order {
  if (order.status === to) return order;
  if (order.status !== from)
    throw new OrderStateError(`Only a ${from} order can become ${to}`);
  return {
    ...order,
    status: to,
    [stamp]: new Date(now),
    updatedAt: new Date(now),
  };
}

export const confirmOrder = (order: Order, now: Date) =>
  advance(order, 'PLACED', 'CONFIRMED', 'confirmedAt', now);
export const shipOrder = (order: Order, now: Date) =>
  advance(order, 'CONFIRMED', 'SHIPPED', 'shippedAt', now);
export const deliverOrder = (order: Order, now: Date) =>
  advance(order, 'SHIPPED', 'DELIVERED', 'deliveredAt', now);

export function cancelOrder(
  order: Order,
  by: OrderCanceller,
  reason: string | null,
  now: Date,
): Order {
  if (order.status === 'CANCELLED') return order;
  const allowed =
    order.status === 'PLACED' ||
    (order.status === 'CONFIRMED' && by !== 'BUYER');
  if (!allowed)
    throw new OrderStateError(
      `A ${order.status} order cannot be cancelled by ${by}`,
    );
  return {
    ...order,
    status: 'CANCELLED',
    cancelledBy: by,
    cancelReason: reason,
    cancelledAt: new Date(now),
    updatedAt: new Date(now),
  };
}
