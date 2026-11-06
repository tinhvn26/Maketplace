export class MediaValidationError extends Error {
  readonly code = 'INVALID_MEDIA_INPUT';
}

export class MediaNotFoundError extends Error {
  readonly code = 'MEDIA_NOT_FOUND';

  constructor(message = 'Media asset not found') {
    super(message);
  }
}

export class MediaForbiddenError extends Error {
  readonly code = 'MEDIA_FORBIDDEN';

  constructor(message = 'Media asset is not available for this shop') {
    super(message);
  }
}

export class MediaInUseError extends Error {
  readonly code = 'MEDIA_IN_USE';

  constructor(message = 'Media asset is still in use') {
    super(message);
  }
}
