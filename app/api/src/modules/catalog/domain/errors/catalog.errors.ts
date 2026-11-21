export class CatalogValidationError extends Error {
  readonly code = 'INVALID_CATALOG_INPUT';

  constructor(message = 'Invalid catalog input') {
    super(message);
    this.name = 'CatalogValidationError';
  }
}

export class CatalogNotFoundError extends Error {
  readonly code = 'CATALOG_NOT_FOUND';

  constructor(message = 'Catalog resource not found') {
    super(message);
    this.name = 'CatalogNotFoundError';
  }
}

export class CatalogConflictError extends Error {
  readonly code: string = 'CATALOG_CONFLICT';

  constructor(
    message = 'Catalog resource conflicts with an existing resource',
  ) {
    super(message);
    this.name = 'CatalogConflictError';
  }
}

export class CatalogVersionConflictError extends CatalogConflictError {
  override readonly code = 'CATALOG_VERSION_CONFLICT';

  constructor(message = 'Catalog resource changed; reload it before retrying') {
    super(message);
    this.name = 'CatalogVersionConflictError';
  }
}

export class CatalogStateError extends CatalogConflictError {
  override readonly code = 'CATALOG_INVALID_STATE';

  constructor(
    message = 'Operation is not allowed in the current product state',
  ) {
    super(message);
    this.name = 'CatalogStateError';
  }
}
