import type { InventoryReservations } from '../../../inventory/contracts/inventory.api.js';
import { cancelOrder } from '../../domain/entities/order.js';
import {
  cancelReason,
  orderPaging,
  orderStatus,
} from '../../domain/policies/order-input.policy.js';
import type {
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

/** A buyer's own orders; anyone else's order is reported as not found. */
export class OrderBuyerService {
  constructor(
    private readonly unitOfWork: OrderUnitOfWork,
    private readonly reservations: InventoryReservations,
    private readonly clock: { now(): Date },
  ) {}

  async list(
    actor: OrderActor,
    query: { status?: unknown; page?: unknown; limit?: unknown },
  ): Promise<OrderPage> {
    const { page, limit } = orderPaging(query.page, query.limit);
    const status =
      query.status === undefined ? undefined : orderStatus(query.status);
    const result = await this.unitOfWork.read((tx) =>
      tx.orders.list({ buyerId: actor.userId, status, page, limit }),
    );
    return toOrderPage(result, page, limit);
  }

  async get(id: string, actor: OrderActor): Promise<OrderView> {
    return toOrderView(
      await findVisible(this.unitOfWork, id, (o) => o.buyerId === actor.userId),
    );
  }

  cancel(
    id: string,
    input: { version: number; reason?: string | null },
    actor: OrderActor,
  ): Promise<OrderView> {
    const reason = cancelReason(input.reason, false);
    const now = this.clock.now();
    return transition(this.unitOfWork, id, input.version, {
      visible: (order) => order.buyerId === actor.userId,
      next: (order) => cancelOrder(order, 'BUYER', reason, now),
      inventory: (order) =>
        releaseForCancel(this.reservations, order.reservationId),
      recheck: (access) => requireActiveAccount(access, actor),
    });
  }
}
