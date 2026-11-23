import type {
  ReservationResult,
  ReserveStockRequest,
} from './inventory.types.js';

export const INVENTORY_RESERVATIONS = Symbol('INVENTORY_RESERVATIONS');

/**
 * Stock holding API for Orders. `reserve` rejects with the CatalogPricing error
 * when a variant is not purchasable (unpublished, inactive, or shop unavailable).
 */
export interface InventoryReservations {
  reserve(request: ReserveStockRequest): Promise<ReservationResult>;
  /** Marks the hold as an order: it no longer expires. Safe to repeat. */
  confirm(reservationId: string): Promise<ReservationResult>;
  /** Returns the units that were not shipped yet. Safe to repeat. */
  release(reservationId: string): Promise<ReservationResult>;
  /** Ships one warehouse's part; the reservation is SHIPPED when all parts shipped. */
  ship(reservationId: string, warehouseId: string): Promise<ReservationResult>;
  /** Expires unconfirmed holds past their TTL; returns how many were expired. */
  expireDue(limit?: number): Promise<number>;
}

export type {
  ReservationAllocation,
  ReservationResult,
  ReserveStockRequest,
} from './inventory.types.js';
export {
  IdempotencyConflictError,
  InsufficientStockError,
  InventoryAccessDeniedError,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryValidationError,
  ReservationStateError,
} from '../domain/errors/inventory.errors.js';
