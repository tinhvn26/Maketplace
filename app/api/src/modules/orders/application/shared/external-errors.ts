import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogValidationError,
  CatalogVersionConflictError,
} from '../../../catalog/contracts/catalog-pricing.api.js';
import {
  InsufficientStockError,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryValidationError,
  ReservationStateError,
} from '../../../inventory/contracts/inventory.api.js';
import {
  OrderItemUnavailableError,
  OrderOutOfStockError,
  OrderPriceChangedError,
  OrderStockExpiredError,
  OrderValidationError,
  OrderVersionConflictError,
} from '../../domain/errors/order.errors.js';

/** Rethrows a Catalog or Inventory error as the matching ORDER_* error, anything else unchanged. */
export function translateExternal(error: unknown): never {
  // Before its base class: a lost catalog write race is retryable, not a price change.
  if (error instanceof CatalogVersionConflictError)
    throw new OrderVersionConflictError();
  if (error instanceof CatalogConflictError) throw new OrderPriceChangedError();
  if (error instanceof CatalogNotFoundError)
    throw new OrderItemUnavailableError();
  if (
    error instanceof CatalogValidationError ||
    error instanceof InventoryValidationError
  )
    throw new OrderValidationError(error.message);
  if (error instanceof InsufficientStockError) throw new OrderOutOfStockError();
  if (error instanceof ReservationStateError)
    throw new OrderStockExpiredError();
  // Lost races (busy after retries, idempotency collisions) are retryable, never a 500.
  if (error instanceof InventoryConflictError)
    throw new OrderVersionConflictError('Inventory is busy; retry');
  if (error instanceof InventoryNotFoundError)
    throw new OrderStockExpiredError();
  throw error;
}
