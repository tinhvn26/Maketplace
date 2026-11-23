import { ReservationStateError } from '../errors/inventory.errors.js';
import { inventoryDate } from '../policies/inventory-input.policy.js';

export type ReservationStatus =
  | 'ACTIVE' // held until expiresAt
  | 'ALLOCATED' // confirmed for an order; no expiry
  | 'SHIPPED' // every warehouse shipped its lines
  | 'RELEASED' // cancelled; unshipped units returned
  | 'EXPIRED'; // TTL passed before confirmation

export interface ReservationLine {
  stockId: string;
  warehouseId: string;
  variantId: string;
  quantity: number;
  shippedAt: Date | null;
}

export interface Reservation {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  reference: string;
  status: ReservationStatus;
  expiresAt: Date | null;
  lines: ReservationLine[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Lines whose units are still held in stock.reserved. */
export function heldLines(reservation: Reservation): ReservationLine[] {
  return reservation.status === 'ACTIVE' || reservation.status === 'ALLOCATED'
    ? reservation.lines.filter((line) => line.shippedAt === null)
    : [];
}

export function isReservationExpired(reservation: Reservation, now: Date) {
  return (
    reservation.status === 'ACTIVE' &&
    reservation.expiresAt !== null &&
    reservation.expiresAt.getTime() <= now.getTime()
  );
}

export function createReservation(input: Omit<Reservation, 'status' | 'version' | 'createdAt' | 'updatedAt'> & {
  now: Date;
}): Reservation {
  const { now, ...rest } = input;
  if (rest.lines.length === 0)
    throw new ReservationStateError('A reservation requires at least one line');
  return {
    ...rest,
    status: 'ACTIVE',
    version: 0,
    createdAt: inventoryDate(now),
    updatedAt: inventoryDate(now),
  };
}

export function confirmReservation(reservation: Reservation, now: Date): Reservation {
  if (reservation.status === 'ALLOCATED') return reservation;
  if (reservation.status !== 'ACTIVE' || isReservationExpired(reservation, now))
    throw new ReservationStateError('Only an unexpired active reservation can be confirmed');
  return { ...reservation, status: 'ALLOCATED', expiresAt: null, updatedAt: inventoryDate(now) };
}

export function shipReservationWarehouse(
  reservation: Reservation,
  warehouseId: string,
  now: Date,
): { reservation: Reservation; shipped: ReservationLine[] } {
  if (reservation.status !== 'ALLOCATED')
    throw new ReservationStateError('Only an allocated reservation can be shipped');
  const shipped = reservation.lines.filter(
    (line) => line.warehouseId === warehouseId && line.shippedAt === null,
  );
  if (shipped.length === 0)
    throw new ReservationStateError('This warehouse has nothing left to ship for the reservation');
  const at = inventoryDate(now);
  const lines = reservation.lines.map((line) =>
    shipped.includes(line) ? { ...line, shippedAt: at } : line,
  );
  return {
    reservation: {
      ...reservation,
      lines,
      status: lines.every((line) => line.shippedAt !== null) ? 'SHIPPED' : 'ALLOCATED',
      updatedAt: at,
    },
    shipped,
  };
}

/** Releasing twice is a no-op so callers can retry cancellation safely. */
export function releaseReservation(
  reservation: Reservation,
  now: Date,
): { reservation: Reservation; released: ReservationLine[] } {
  if (reservation.status === 'RELEASED') return { reservation, released: [] };
  if (reservation.status !== 'ACTIVE' && reservation.status !== 'ALLOCATED')
    throw new ReservationStateError('Only an active or allocated reservation can be released');
  return {
    reservation: { ...reservation, status: 'RELEASED', expiresAt: null, updatedAt: inventoryDate(now) },
    released: heldLines(reservation),
  };
}

export function expireReservation(
  reservation: Reservation,
  now: Date,
): { reservation: Reservation; released: ReservationLine[] } {
  if (!isReservationExpired(reservation, now))
    throw new ReservationStateError('Reservation has not expired');
  return {
    reservation: { ...reservation, status: 'EXPIRED', updatedAt: inventoryDate(now) },
    released: heldLines(reservation),
  };
}
