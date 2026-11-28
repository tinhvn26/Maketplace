import type { Order, OrderLine } from '../../domain/entities/order.js';

export type OrderView = Omit<Order, 'reservationId' | 'updatedAt' | 'lines'> & {
  lines: Omit<OrderLine, 'productVersion'>[];
};

export interface OrderPage {
  items: OrderView[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function toOrderView(order: Order): OrderView {
  const {
    reservationId: _reservationId,
    updatedAt: _updatedAt,
    lines,
    ...rest
  } = order;
  return {
    ...rest,
    lines: lines.map(({ productVersion: _productVersion, ...line }) => line),
  };
}

export function toOrderPage(
  result: { items: Order[]; total: number },
  page: number,
  limit: number,
): OrderPage {
  return {
    items: result.items.map(toOrderView),
    total: result.total,
    page,
    limit,
    pages: Math.ceil(result.total / limit),
  };
}
