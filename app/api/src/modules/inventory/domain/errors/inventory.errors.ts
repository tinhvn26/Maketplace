export class InventoryValidationError extends Error {
  readonly code = 'INVALID_INVENTORY_INPUT';
  constructor(message = 'Invalid inventory input') {
    super(message);
    this.name = 'InventoryValidationError';
  }
}

export class InventoryNotFoundError extends Error {
  readonly code = 'INVENTORY_NOT_FOUND';
  constructor(message = 'Inventory resource not found') {
    super(message);
    this.name = 'InventoryNotFoundError';
  }
}

export class InventoryAccessDeniedError extends Error {
  readonly code = 'INVENTORY_ACCESS_DENIED';
  constructor(message = 'Administrator access is required') {
    super(message);
    this.name = 'InventoryAccessDeniedError';
  }
}

export class InventoryConflictError extends Error {
  readonly code: string = 'INVENTORY_CONFLICT';
  constructor(message = 'Inventory resource conflicts with an existing one') {
    super(message);
    this.name = 'InventoryConflictError';
  }
}

/** Optimistic-lock loss; callers retry the whole unit of work. */
export class InventoryVersionConflictError extends InventoryConflictError {
  override readonly code = 'INVENTORY_VERSION_CONFLICT';
  constructor(message = 'Inventory changed; reload it before retrying') {
    super(message);
    this.name = 'InventoryVersionConflictError';
  }
}

/** The client sent an outdated version; retrying the same request cannot succeed. */
export class InventoryStaleVersionError extends InventoryConflictError {
  override readonly code = 'INVENTORY_STALE_VERSION';
  constructor(message = 'Inventory changed; reload it before retrying') {
    super(message);
    this.name = 'InventoryStaleVersionError';
  }
}

export class InsufficientStockError extends InventoryConflictError {
  override readonly code = 'INSUFFICIENT_STOCK';
  constructor(message = 'Not enough stock is available') {
    super(message);
    this.name = 'InsufficientStockError';
  }
}

export class ReservationStateError extends InventoryConflictError {
  override readonly code = 'INVALID_RESERVATION_STATE';
  constructor(message = 'Reservation cannot change from its current state') {
    super(message);
    this.name = 'ReservationStateError';
  }
}

export class IdempotencyConflictError extends InventoryConflictError {
  override readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor(
    message = 'Idempotency key was already used with a different request',
  ) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}
