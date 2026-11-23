import type { Reservation } from '../../domain/entities/reservation.js';

export interface ReservationRepository {
  findById(id: string): Promise<Reservation | null>;
  findByIdempotencyKey(key: string): Promise<Reservation | null>;
  /** A duplicate idempotency key rejects with InventoryVersionConflictError so the caller re-reads it. */
  insert(reservation: Reservation): Promise<void>;
  /** Compare-and-set on version; rejects with InventoryVersionConflictError when it lost. */
  save(reservation: Reservation, expectedVersion: number): Promise<Reservation>;
  /** Ids of ACTIVE reservations whose expiresAt is at or before `now`, oldest first. */
  findExpiredIds(now: Date, limit: number): Promise<string[]>;
}
