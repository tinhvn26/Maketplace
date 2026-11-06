import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ShopAccessDeniedError,
  ShopConflictError,
  ShopNotFoundError,
  ShopValidationError,
} from '../../../domain/errors/shop.errors.js';

type ShopError =
  | ShopAccessDeniedError
  | ShopConflictError
  | ShopNotFoundError
  | ShopValidationError;

@Catch(
  ShopAccessDeniedError,
  ShopConflictError,
  ShopNotFoundError,
  ShopValidationError,
)
export class ShopsExceptionFilter implements ExceptionFilter<ShopError> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}
  catch(error: ShopError, host: ArgumentsHost): void {
    const status =
      error instanceof ShopValidationError
        ? HttpStatus.BAD_REQUEST
        : error instanceof ShopAccessDeniedError
          ? HttpStatus.FORBIDDEN
          : error instanceof ShopNotFoundError
            ? HttpStatus.NOT_FOUND
            : HttpStatus.CONFLICT;
    const title =
      status === 400
        ? 'Bad Request'
        : status === 403
          ? 'Forbidden'
          : status === 404
            ? 'Not Found'
            : 'Conflict';
    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode: status,
        message: error.message,
        error: title,
        code: error.code,
      },
      status,
    );
  }
}
