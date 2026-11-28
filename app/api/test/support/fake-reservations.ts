import {
  InsufficientStockError,
  InventoryNotFoundError,
  ReservationStateError,
  type InventoryReservations,
  type ReservationResult,
  type ReserveStockRequest,
} from '../../src/modules/inventory/contracts/inventory.api.js';

/** Inventory reservations with the same state rules as the Inventory domain, recording every call. */
export class FakeReservations implements InventoryReservations {
  reservations = new Map<string, ReservationResult>();
  /** Variants whose reserve fails with InsufficientStockError. */
  failReserveFor = new Set<string>();
  allocate = (_variantId: string) => 'w1';
  /** `reserve:<reference>`, `confirm:<id>`, `release:<id>`, `ship:<id>:<warehouseId>`. */
  calls: string[] = [];
  private byKey = new Map<string, string>();

  async reserve(request: ReserveStockRequest): Promise<ReservationResult> {
    this.calls.push(`reserve:${request.reference}`);
    const known = this.byKey.get(request.idempotencyKey);
    if (known) return this.get(known);
    if (request.lines.some((line) => this.failReserveFor.has(line.variantId)))
      throw new InsufficientStockError();
    const reservation: ReservationResult = {
      reservationId: `r${this.reservations.size + 1}`,
      reference: request.reference,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      allocations: request.lines.map(({ variantId, quantity }) => ({
        variantId,
        warehouseId: this.allocate(variantId),
        quantity,
        shipped: false,
      })),
    };
    this.reservations.set(reservation.reservationId, reservation);
    this.byKey.set(request.idempotencyKey, reservation.reservationId);
    return reservation;
  }

  async get(reservationId: string): Promise<ReservationResult> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new InventoryNotFoundError('Reservation not found');
    return reservation;
  }

  // Does not model TTL expiry: tests set EXPIRED directly.
  async confirm(reservationId: string): Promise<ReservationResult> {
    this.calls.push(`confirm:${reservationId}`);
    const reservation = await this.get(reservationId);
    if (reservation.status === 'ALLOCATED') return reservation;
    if (reservation.status !== 'ACTIVE') throw new ReservationStateError();
    return this.put({ ...reservation, status: 'ALLOCATED', expiresAt: null });
  }

  async release(
    reservationId: string,
    options: { refuseIfShipped?: boolean } = {},
  ): Promise<ReservationResult> {
    const reservation = await this.get(reservationId);
    // A refused release changes nothing, so it is not recorded in `calls`.
    if (
      options.refuseIfShipped &&
      reservation.allocations.some((a) => a.shipped)
    )
      throw new ReservationStateError(
        'Part of the reservation has already shipped',
      );
    this.calls.push(`release:${reservationId}`);
    if (reservation.status === 'RELEASED') return reservation;
    if (reservation.status !== 'ACTIVE' && reservation.status !== 'ALLOCATED')
      throw new ReservationStateError();
    return this.put({ ...reservation, status: 'RELEASED', expiresAt: null });
  }

  async ship(
    reservationId: string,
    warehouseId: string,
  ): Promise<ReservationResult> {
    this.calls.push(`ship:${reservationId}:${warehouseId}`);
    const reservation = await this.get(reservationId);
    if (
      reservation.status !== 'ALLOCATED' ||
      !reservation.allocations.some(
        (a) => a.warehouseId === warehouseId && !a.shipped,
      )
    )
      throw new ReservationStateError();
    const allocations = reservation.allocations.map((a) =>
      a.warehouseId === warehouseId ? { ...a, shipped: true } : a,
    );
    return this.put({
      ...reservation,
      allocations,
      status: allocations.every((a) => a.shipped) ? 'SHIPPED' : 'ALLOCATED',
    });
  }

  async expireDue(): Promise<number> {
    return 0;
  }

  private put(reservation: ReservationResult) {
    this.reservations.set(reservation.reservationId, reservation);
    return reservation;
  }
}
