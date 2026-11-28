import { createHash } from 'node:crypto';
import type {
  CatalogPricing,
  CatalogQuoteLine,
} from '../../../catalog/contracts/catalog-pricing.api.js';
import {
  type InventoryReservations,
  ReservationStateError,
} from '../../../inventory/contracts/inventory.api.js';
import {
  cancelOrder,
  placeOrder,
  type Order,
  type ShippingAddress,
} from '../../domain/entities/order.js';
import {
  OrderAccessDeniedError,
  OrderIdempotencyConflictError,
  OrderOutOfStockError,
} from '../../domain/errors/order.errors.js';
import {
  checkoutLines,
  idempotencyKey,
  orderNote,
  shippingAddress,
  type CheckoutLineInput,
} from '../../domain/policies/order-input.policy.js';
import type {
  OrderActor,
  OrderCheckoutRecord,
  OrderUnitOfWork,
} from '../ports/order-unit-of-work.js';
import { translateExternal } from '../shared/external-errors.js';
import { toOrderView, type OrderView } from '../shared/order-view.js';

export interface PlaceOrderInput {
  idempotencyKey: string;
  lines: CheckoutLineInput[];
  shippingAddress: ShippingAddress;
  note?: string | null;
}

export interface PlaceOrderResult {
  created: boolean;
  checkoutId: string;
  orders: OrderView[];
}

type Checkout = { checkout: OrderCheckoutRecord; orders: Order[] };

/** Places one checkout as one order per seller, holding stock as a saga with `release` as compensation. */
export class OrderCheckoutService {
  constructor(
    private readonly unitOfWork: OrderUnitOfWork,
    private readonly pricing: CatalogPricing,
    private readonly reservations: InventoryReservations,
    private readonly ids: { next(): string },
    private readonly clock: { now(): Date },
  ) {}

  async place(
    input: PlaceOrderInput,
    actor: OrderActor,
  ): Promise<PlaceOrderResult> {
    const key = idempotencyKey(input.idempotencyKey);
    const lines = checkoutLines(input.lines);
    const address = shippingAddress(input.shippingAddress);
    const note = orderNote(input.note);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ lines, shippingAddress: address, note }))
      .digest('hex');

    const existing = await this.unitOfWork.read((tx) =>
      tx.orders.findCheckout(actor.userId, key),
    );
    if (existing) return replay(existing, requestHash);

    const first = await this.pricing.quote({ lines }).catch(translateExternal);
    const groups = new Map<string | null, CatalogQuoteLine[]>();
    for (const line of first.lines)
      groups.set(line.shopId, [...(groups.get(line.shopId) ?? []), line]);

    const now = this.clock.now();
    const checkout: OrderCheckoutRecord = {
      id: this.ids.next(),
      buyerId: actor.userId,
      idempotencyKey: key,
      requestHash,
      createdAt: now,
    };
    const held: string[] = [];
    const orders: Order[] = [];
    let winner: Checkout | null;
    try {
      for (const [shopId, quoted] of groups) {
        const id = this.ids.next();
        const reservation = await this.reservations.reserve({
          idempotencyKey: `order:${id}`,
          reference: id,
          lines: quoted.map(({ variantId, quantity }) => ({
            variantId,
            quantity,
          })),
        });
        held.push(reservation.reservationId);
        orders.push(
          placeOrder({
            id,
            checkoutId: checkout.id,
            buyerId: actor.userId,
            shopId,
            reservationId: reservation.reservationId,
            lines: quoted.map((line) => ({
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
            shippingAddress: address,
            note,
            now,
          }),
        );
      }
      // Catches a variant withdrawn between the first quote and the holds.
      await this.pricing.quote({
        lines: first.lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          expectedUnitPriceAmount: line.unitPriceAmount,
          expectedProductVersion: line.productVersion,
        })),
      });
      winner = await this.unitOfWork.run(async (tx) => {
        if (!(await tx.access.isActiveAccount(actor)))
          throw new OrderAccessDeniedError();
        const raced = await tx.orders.findCheckout(actor.userId, key);
        if (!raced) await tx.orders.insertCheckout(checkout, orders);
        return raced;
      });
    } catch (error) {
      await this.releaseAll(held);
      // A double submit can fail here only because the first submit holds the stock; answer with its orders.
      const raced = await this.unitOfWork
        .read((tx) => tx.orders.findCheckout(actor.userId, key))
        .catch(() => null);
      if (raced) return replay(raced, requestHash);
      translateExternal(error);
    }

    if (winner) {
      await this.releaseAll(held);
      return replay(winner, requestHash);
    }

    // shortcut: a crash between the insert above and these confirms leaves PLACED orders with ACTIVE holds that expire after the TTL; the seller's confirm then fails with ORDER_STOCK_EXPIRED and they must cancel. Add a job that sweeps PLACED orders with expired holds when this matters.
    try {
      for (const order of orders)
        await this.reservations.confirm(order.reservationId);
    } catch {
      await this.cancelAll(orders);
      throw new OrderOutOfStockError();
    }
    return {
      created: true,
      checkoutId: checkout.id,
      orders: orders.map(toOrderView),
    };
  }

  private async cancelAll(orders: Order[]) {
    for (const order of orders) {
      // A hold that could not be released stays PLACED so a later cancel releases it.
      if (!(await this.release(order.reservationId))) continue;
      // A failed save leaves this order PLACED with its stock returned; the others still get cancelled.
      await this.unitOfWork
        .run((tx) =>
          tx.orders.save(
            cancelOrder(
              order,
              'SYSTEM',
              'Không giữ được hàng',
              this.clock.now(),
            ),
            order.version,
          ),
        )
        .catch(() => undefined);
    }
  }

  private async releaseAll(reservationIds: string[]) {
    // Best effort: an unconfirmed hold that fails to release still expires after its TTL.
    for (const id of reservationIds) await this.release(id);
  }

  /** True when the reservation no longer holds stock. */
  private async release(reservationId: string): Promise<boolean> {
    try {
      await this.reservations.release(reservationId);
      return true;
    } catch (error) {
      // Expired or already finished: nothing is held any more.
      return error instanceof ReservationStateError;
    }
  }
}

function replay(existing: Checkout, requestHash: string): PlaceOrderResult {
  if (existing.checkout.requestHash !== requestHash)
    throw new OrderIdempotencyConflictError();
  return {
    created: false,
    checkoutId: existing.checkout.id,
    orders: existing.orders.map(toOrderView),
  };
}
