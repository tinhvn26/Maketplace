export class ShopValidationError extends Error {
  readonly code = 'INVALID_SHOP_INPUT';
  constructor(message = 'Invalid shop input') {
    super(message);
    this.name = 'ShopValidationError';
  }
}

export class ShopNotFoundError extends Error {
  readonly code = 'SHOP_NOT_FOUND';
  constructor(message = 'Shop not found') {
    super(message);
    this.name = 'ShopNotFoundError';
  }
}

export class ShopAccessDeniedError extends Error {
  readonly code = 'SHOP_ACCESS_DENIED';
  constructor(
    message = 'An active shop owner or administrator account is required',
  ) {
    super(message);
    this.name = 'ShopAccessDeniedError';
  }
}

export class ShopConflictError extends Error {
  readonly code: string = 'SHOP_CONFLICT';
  constructor(message = 'Shop conflicts with an existing resource') {
    super(message);
    this.name = 'ShopConflictError';
  }
}

export class ShopVersionConflictError extends ShopConflictError {
  override readonly code = 'SHOP_VERSION_CONFLICT';
  constructor(message = 'Shop changed; reload it before retrying') {
    super(message);
    this.name = 'ShopVersionConflictError';
  }
}

export class ShopUnavailableError extends ShopConflictError {
  override readonly code = 'SHOP_UNAVAILABLE';
  constructor(message = 'Shop is not active or available for selling') {
    super(message);
    this.name = 'ShopUnavailableError';
  }
}
