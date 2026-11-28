import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
} from '../../../../shops/contracts/shops.api.js';
import {
  OrderAccessDeniedError,
  OrderConflictError,
  OrderNotFoundError,
  OrderValidationError,
} from '../../../domain/errors/order.errors.js';

type OrdersHttpError =
  | OrderAccessDeniedError
  | OrderConflictError
  | OrderNotFoundError
  | OrderValidationError
  | ShopAccessDeniedError
  | ShopNotFoundError
  | ShopUnavailableError;

const TITLES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
};

@Catch(
  OrderAccessDeniedError,
  OrderConflictError,
  OrderNotFoundError,
  OrderValidationError,
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
)
export class OrdersExceptionFilter implements ExceptionFilter<OrdersHttpError> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(error: OrdersHttpError, host: ArgumentsHost): void {
    const status =
      error instanceof OrderValidationError
        ? HttpStatus.BAD_REQUEST
        : error instanceof OrderAccessDeniedError ||
            error instanceof ShopAccessDeniedError
          ? HttpStatus.FORBIDDEN
          : error instanceof OrderNotFoundError ||
              error instanceof ShopNotFoundError
            ? HttpStatus.NOT_FOUND
            : HttpStatus.CONFLICT;
    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode: status,
        message: error.message,
        error: TITLES[status],
        code: error.code,
      },
      status,
    );
  }
}
