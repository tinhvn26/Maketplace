import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import type { PrismaService } from '../../../../platform/database/prisma.service.js';
import type {
  OrderCheckoutRecord,
  OrderListQuery,
  OrderStore,
} from '../../application/ports/order-unit-of-work.js';
import type {
  Order,
  OrderCanceller,
  OrderStatus,
} from '../../domain/entities/order.js';
import { OrderVersionConflictError } from '../../domain/errors/order.errors.js';

const withLines = {
  lines: { orderBy: { position: 'asc' } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof withLines }>;

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    checkoutId: row.checkoutId,
    buyerId: row.buyerId,
    shopId: row.shopId,
    status: row.status as OrderStatus,
    reservationId: row.reservationId,
    lines: row.lines.map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      productName: line.productName,
      variantName: line.variantName,
      sku: line.sku,
      quantity: line.quantity,
      unitPriceAmount: line.unitPriceAmount,
      lineTotalAmount: line.lineTotalAmount,
      productVersion: line.productVersion,
    })),
    subtotalAmount: row.subtotalAmount,
    currency: 'VND',
    shippingAddress: {
      recipientName: row.recipientName,
      phoneNumber: row.phoneNumber,
      addressLine: row.addressLine,
    },
    note: row.note,
    cancelReason: row.cancelReason,
    cancelledBy: row.cancelledBy as OrderCanceller | null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
  };
}

export class PrismaOrderStore implements OrderStore {
  constructor(private readonly db: PrismaService | Prisma.TransactionClient) {}

  async findCheckout(buyerId: string, idempotencyKey: string) {
    const row = await this.db.orderCheckout.findUnique({
      where: { buyerId_idempotencyKey: { buyerId, idempotencyKey } },
      include: { orders: { include: withLines, orderBy: { id: 'asc' } } },
    });
    if (!row) return null;
    const { orders, ...checkout } = row;
    return { checkout, orders: orders.map(toOrder) };
  }

  async insertCheckout(checkout: OrderCheckoutRecord, orders: Order[]) {
    await this.db.orderCheckout.create({ data: checkout });
    for (const order of orders)
      await this.db.order.create({
        data: {
          id: order.id,
          checkoutId: order.checkoutId,
          buyerId: order.buyerId,
          shopId: order.shopId,
          status: order.status,
          reservationId: order.reservationId,
          subtotalAmount: order.subtotalAmount,
          currency: order.currency,
          ...order.shippingAddress,
          note: order.note,
          cancelReason: order.cancelReason,
          cancelledBy: order.cancelledBy,
          version: order.version,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          confirmedAt: order.confirmedAt,
          shippedAt: order.shippedAt,
          deliveredAt: order.deliveredAt,
          cancelledAt: order.cancelledAt,
          lines: {
            create: order.lines.map((line, position) => ({
              ...line,
              id: randomUUID(),
              position,
            })),
          },
        },
      });
  }

  async findById(id: string) {
    const row = await this.db.order.findUnique({
      where: { id },
      include: withLines,
    });
    return row ? toOrder(row) : null;
  }

  async list(query: OrderListQuery) {
    const where: Prisma.OrderWhereInput = {
      ...(query.buyerId !== undefined && { buyerId: query.buyerId }),
      ...(query.shopId !== undefined && { shopId: query.shopId }),
      ...(query.status !== undefined && { status: query.status }),
    };
    const [rows, total] = await Promise.all([
      this.db.order.findMany({
        where,
        include: withLines,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.order.count({ where }),
    ]);
    return { items: rows.map(toOrder), total };
  }

  async save(order: Order, expectedVersion: number) {
    const { count } = await this.db.order.updateMany({
      where: { id: order.id, version: expectedVersion },
      data: {
        status: order.status,
        cancelReason: order.cancelReason,
        cancelledBy: order.cancelledBy,
        updatedAt: order.updatedAt,
        confirmedAt: order.confirmedAt,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        version: { increment: 1 },
      },
    });
    if (count !== 1) throw new OrderVersionConflictError();
    return { ...order, version: expectedVersion + 1 };
  }
}
