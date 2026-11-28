export class OrderValidationError extends Error {
  readonly code = 'ORDER_INVALID_INPUT';
  constructor(message = 'Invalid order input') {
    super(message);
    this.name = 'OrderValidationError';
  }
}

export class OrderNotFoundError extends Error {
  readonly code = 'ORDER_NOT_FOUND';
  constructor(message = 'Order not found') {
    super(message);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderAccessDeniedError extends Error {
  readonly code = 'ORDER_ACCESS_DENIED';
  constructor(message = 'You are not allowed to access this order') {
    super(message);
    this.name = 'OrderAccessDeniedError';
  }
}

export class OrderConflictError extends Error {
  readonly code: string = 'ORDER_CONFLICT';
  constructor(message = 'Order conflicts with an existing resource') {
    super(message);
    this.name = 'OrderConflictError';
  }
}

export class OrderVersionConflictError extends OrderConflictError {
  override readonly code = 'ORDER_VERSION_CONFLICT';
  constructor(message = 'Order changed; reload it before retrying') {
    super(message);
    this.name = 'OrderVersionConflictError';
  }
}

export class OrderStateError extends OrderConflictError {
  override readonly code = 'ORDER_STATE_CONFLICT';
  constructor(message = 'Order is not in a state that allows this change') {
    super(message);
    this.name = 'OrderStateError';
  }
}

export class OrderIdempotencyConflictError extends OrderConflictError {
  override readonly code = 'ORDER_IDEMPOTENCY_CONFLICT';
  constructor(message = 'Idempotency key was used with a different request') {
    super(message);
    this.name = 'OrderIdempotencyConflictError';
  }
}

export class OrderPriceChangedError extends OrderConflictError {
  override readonly code = 'ORDER_PRICE_CHANGED';
  constructor(message = 'An item price changed; review the cart again') {
    super(message);
    this.name = 'OrderPriceChangedError';
  }
}

export class OrderItemUnavailableError extends OrderConflictError {
  override readonly code = 'ORDER_ITEM_UNAVAILABLE';
  constructor(message = 'An item is no longer available for sale') {
    super(message);
    this.name = 'OrderItemUnavailableError';
  }
}

export class OrderOutOfStockError extends OrderConflictError {
  override readonly code = 'ORDER_OUT_OF_STOCK';
  constructor(message = 'Not enough stock for an item') {
    super(message);
    this.name = 'OrderOutOfStockError';
  }
}

export class OrderStockExpiredError extends OrderConflictError {
  override readonly code = 'ORDER_STOCK_EXPIRED';
  constructor(message = 'The stock hold for this order has expired') {
    super(message);
    this.name = 'OrderStockExpiredError';
  }
}
