import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
} from '../../shops/contracts/shops.api.js';
import {
  MediaForbiddenError,
  MediaInUseError,
  MediaNotFoundError,
  MediaValidationError,
} from '../domain/media.errors.js';

type MediaError =
  | MediaValidationError
  | MediaNotFoundError
  | MediaForbiddenError
  | MediaInUseError
  | ShopAccessDeniedError
  | ShopNotFoundError
  | ShopUnavailableError;

@Catch(
  MediaValidationError,
  MediaNotFoundError,
  MediaForbiddenError,
  MediaInUseError,
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
)
export class MediaExceptionFilter implements ExceptionFilter<MediaError> {
  constructor(private readonly host: HttpAdapterHost) {}

  catch(exception: MediaError, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof MediaValidationError
        ? 400
        : exception instanceof MediaNotFoundError ||
            exception instanceof ShopNotFoundError
          ? 404
          : exception instanceof MediaInUseError ||
              exception instanceof ShopUnavailableError
            ? 409
            : 403;
    this.host.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode,
        error: (
          {
            400: 'Bad Request',
            403: 'Forbidden',
            404: 'Not Found',
            409: 'Conflict',
          } as Record<number, string>
        )[statusCode],
        message: exception.message,
        code: exception.code,
      },
      statusCode,
    );
  }
}
