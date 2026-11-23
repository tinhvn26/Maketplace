import type { ReservationStatus } from '../domain/entities/reservation.js';

export interface ReserveStockRequest {
  /** Same key + same request returns the original reservation; a different request is rejected. */
  idempotencyKey: string;
  /** Caller's reference, for example an order id. */
  reference: string;
  lines: Array<{ variantId: string; quantity: number }>;
}

export interface ReservationAllocation {
  variantId: string;
  warehouseId: string;
  quantity: number;
  shipped: boolean;
}

export interface ReservationResult {
  reservationId: string;
  reference: string;
  status: ReservationStatus;
  /** Null once the reservation is confirmed. */
  expiresAt: Date | null;
  allocations: ReservationAllocation[];
}
