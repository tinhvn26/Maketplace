import {
  type InventoryReservations,
  ReservationStateError,
} from '../../../inventory/contracts/inventory.api.js';
import type { Order } from '../../domain/entities/order.js';
import {
  OrderAccessDeniedError,
  OrderNotFoundError,
  OrderStateError,
  OrderVersionConflictError,
} from '../../domain/errors/order.errors.js';
import {
  orderId,
  orderVersion,
} from '../../domain/policies/order-input.policy.js';
import type {
  OrderAccessReader,
  OrderActor,
  OrderUnitOfWork,
} from '../ports/order-unit-of-work.js';
import { translateExternal } from './external-errors.js';
import { toOrderView, type OrderView } from './order-view.js';

/** Loads an order the caller may see, or throws OrderNotFoundError. */
export async function findVisible(
  unitOfWork: OrderUnitOfWork,
  id: unknown,
  visible: (order: Order) => boolean,
): Promise<Order> {
  const order = await unitOfWork.read((tx) => tx.orders.findById(orderId(id)));
  if (!order || !visible(order)) throw new OrderNotFoundError();
  return order;
}

/** Inside a write transaction: the account must still be active with its current role. */
export async function requireActiveAccount(
  access: OrderAccessReader,
  actor: OrderActor,
): Promise<void> {
  if (!(await access.isActiveAccount(actor)))
    throw new OrderAccessDeniedError(
      'An active account with current privileges is required',
    );
}

/**
 * Read and check, then the Inventory side effect (safe to repeat), then the
 * write with an access recheck and compare-and-set. A no-op transition still
 * runs the side effect so a retry heals a half-finished earlier attempt, and
 * repeating an action already applied returns the order even with an old version.
 *
 * shortcut: the Inventory call runs before the compare-and-set, so a seller confirm that commits between a buyer's release and the buyer's write leaves the order CONFIRMED with its hold RELEASED (ship then fails ORDER_STOCK_EXPIRED and a seller/admin cancel repairs it); likewise an account locked mid-request gets its hold released while the write is refused (recoverable the same way), upgrade to a per-order lock or a reconciliation job when this happens in practice.
 */
export async function transition(
  unitOfWork: OrderUnitOfWork,
  id: unknown,
  version: unknown,
  steps: {
    visible: (order: Order) => boolean;
    next: (order: Order) => Order;
    inventory: (order: Order) => Promise<unknown>;
    recheck: (access: OrderAccessReader) => Promise<void>;
  },
): Promise<OrderView> {
  const expected = orderVersion(version);
  const current = await findVisible(unitOfWork, id, steps.visible);
  if (current.version !== expected && !alreadyApplied(current, steps.next))
    throw new OrderVersionConflictError();
  const next = steps.next(current);
  await steps.inventory(current).catch(translateExternal);
  if (next === current) return toOrderView(current);
  return toOrderView(
    await unitOfWork.run(async (tx) => {
      await steps.recheck(tx.access);
      const fresh = await tx.orders.findById(current.id);
      if (
        fresh &&
        fresh.version !== expected &&
        alreadyApplied(fresh, steps.next)
      )
        return fresh;
      if (fresh?.version !== expected) throw new OrderVersionConflictError();
      return tx.orders.save(next, expected);
    }),
  );
}

/** True when the action leaves the order unchanged, i.e. it was already applied. */
function alreadyApplied(order: Order, next: (order: Order) => Order) {
  try {
    return next(order) === order;
  } catch (error) {
    if (error instanceof OrderStateError) return false;
    throw error;
  }
}

/** Returns an order's stock; stock that already left a warehouse makes the cancel a state conflict. */
export async function releaseForCancel(
  reservations: InventoryReservations,
  reservationId: string,
): Promise<void> {
  const shipped = new OrderStateError(
    'Stock for this order has already shipped',
  );
  try {
    // Refused inside Inventory's write transaction, so a concurrent ship cannot slip past it.
    await reservations.release(reservationId, { refuseIfShipped: true });
  } catch (error) {
    if (!(error instanceof ReservationStateError)) throw error;
    // An expired hold already gave its stock back, so the cancel can go ahead.
    const { status } = await reservations.get(reservationId);
    if (status !== 'EXPIRED') throw shipped;
  }
}
