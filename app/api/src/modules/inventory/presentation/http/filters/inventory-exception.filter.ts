import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
} from '../../../../shops/contracts/shops.api.js';
import {
  InventoryAccessDeniedError,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryValidationError,
} from '../../../domain/errors/inventory.errors.js';

type InventoryHttpError =
  | InventoryAccessDeniedError
  | InventoryConflictError
  | InventoryNotFoundError
  | InventoryValidationError
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
  InventoryAccessDeniedError,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryValidationError,
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
)
export class InventoryExceptionFilter implements ExceptionFilter<InventoryHttpError> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(error: InventoryHttpError, host: ArgumentsHost): void {
    const status =
      error instanceof InventoryValidationError
        ? HttpStatus.BAD_REQUEST
        : error instanceof InventoryAccessDeniedError ||
            error instanceof ShopAccessDeniedError
          ? HttpStatus.FORBIDDEN
          : error instanceof InventoryNotFoundError ||
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
