import { describe, expect, it } from 'vitest';
import { ReservationStateError } from '../errors/inventory.errors.js';
import {
  confirmReservation,
  createReservation,
  expireReservation,
  heldLines,
  releaseReservation,
  shipReservationWarehouse,
} from './reservation.js';

const now = new Date('2026-11-22T00:00:00.000Z');
const later = new Date('2026-11-22T00:20:00.000Z');
const active = createReservation({
  id: 'r1',
  idempotencyKey: 'order-1',
  requestHash: 'hash',
  reference: 'order-1',
  expiresAt: new Date('2026-11-22T00:15:00.000Z'),
  lines: [
    {
      stockId: 'a',
      warehouseId: 'wa',
      variantId: 'v1',
      quantity: 2,
      shippedAt: null,
    },
    {
      stockId: 'b',
      warehouseId: 'wb',
      variantId: 'v1',
      quantity: 1,
      shippedAt: null,
    },
  ],
  now,
});

describe('Reservation', () => {
  it('ships per warehouse and becomes SHIPPED when every warehouse shipped', () => {
    const allocated = confirmReservation(active, now);
    expect(allocated).toMatchObject({ status: 'ALLOCATED', expiresAt: null });
    const first = shipReservationWarehouse(allocated, 'wa', now);
    expect(first.shipped.map((line) => line.stockId)).toEqual(['a']);
    expect(first.reservation.status).toBe('ALLOCATED');
    expect(() =>
      shipReservationWarehouse(first.reservation, 'wa', now),
    ).toThrow(ReservationStateError);
    expect(
      shipReservationWarehouse(first.reservation, 'wb', now).reservation.status,
    ).toBe('SHIPPED');
  });

  it('releases only the unshipped part and is idempotent', () => {
    const partly = shipReservationWarehouse(
      confirmReservation(active, now),
      'wa',
      now,
    ).reservation;
    const { reservation, released } = releaseReservation(partly, now);
    expect(released.map((line) => line.stockId)).toEqual(['b']);
    expect(heldLines(reservation)).toEqual([]);
    expect(releaseReservation(reservation, now).released).toEqual([]);
  });

  it('expires only active reservations past their TTL', () => {
    expect(() => expireReservation(active, now)).toThrow(ReservationStateError);
    const expired = expireReservation(active, later);
    expect(expired.reservation.status).toBe('EXPIRED');
    expect(expired.released).toHaveLength(2);
    expect(() => confirmReservation(active, later)).toThrow(
      ReservationStateError,
    );
    expect(() => confirmReservation(expired.reservation, later)).toThrow(
      ReservationStateError,
    );
  });

  it('cannot ship before confirmation or release after shipping', () => {
    expect(() => shipReservationWarehouse(active, 'wa', now)).toThrow(
      ReservationStateError,
    );
    let shipped = confirmReservation(active, now);
    shipped = shipReservationWarehouse(shipped, 'wa', now).reservation;
    shipped = shipReservationWarehouse(shipped, 'wb', now).reservation;
    expect(() => releaseReservation(shipped, now)).toThrow(
      ReservationStateError,
    );
  });
});
