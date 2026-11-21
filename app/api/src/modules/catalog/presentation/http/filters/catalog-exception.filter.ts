import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogStateError,
  CatalogValidationError,
  CatalogVersionConflictError,
} from '../../../domain/errors/catalog.errors.js';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
} from '../../../../shops/contracts/shops.api.js';
import {
  MediaValidationError,
  MediaNotFoundError,
  MediaForbiddenError,
  MediaInUseError,
} from '../../../../media/contracts/media.api.js';

type CatalogError =
  | CatalogValidationError
  | CatalogNotFoundError
  | CatalogConflictError
  | CatalogVersionConflictError
  | CatalogStateError;
type CatalogBoundaryError =
  | CatalogError
  | ShopAccessDeniedError
  | ShopNotFoundError
  | ShopUnavailableError;
type CatalogIntegrationError =
  | CatalogBoundaryError
  | MediaValidationError
  | MediaNotFoundError
  | MediaForbiddenError
  | MediaInUseError;

@Catch(
  CatalogValidationError,
  CatalogNotFoundError,
  CatalogConflictError,
  CatalogVersionConflictError,
  CatalogStateError,
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
  MediaValidationError,
  MediaNotFoundError,
  MediaForbiddenError,
  MediaInUseError,
)
export class CatalogExceptionFilter implements ExceptionFilter<CatalogIntegrationError> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: CatalogIntegrationError, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof CatalogValidationError ||
      exception instanceof MediaValidationError
        ? HttpStatus.BAD_REQUEST
        : exception instanceof ShopAccessDeniedError ||
            exception instanceof MediaForbiddenError
          ? HttpStatus.FORBIDDEN
          : exception instanceof CatalogNotFoundError ||
              exception instanceof ShopNotFoundError ||
              exception instanceof MediaNotFoundError
            ? HttpStatus.NOT_FOUND
            : HttpStatus.CONFLICT;
    const error =
      statusCode === HttpStatus.BAD_REQUEST
        ? 'Bad Request'
        : statusCode === HttpStatus.FORBIDDEN
          ? 'Forbidden'
          : statusCode === HttpStatus.NOT_FOUND
            ? 'Not Found'
            : 'Conflict';

    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      { statusCode, message: exception.message, error, code: exception.code },
      statusCode,
    );
  }
}
