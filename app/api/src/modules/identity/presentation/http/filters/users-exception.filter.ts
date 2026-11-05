import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  EmailAlreadyExistsError,
  InvalidFullNameError,
} from '../../../application/errors/auth.errors.js';
import {
  EmptyProfileUpdateError,
  AccountChangedError,
  AdminRequiredError,
  IncorrectPasswordError,
  InvalidAccountInputError,
  LastAdminError,
  UserNotFoundError,
  UserUnavailableError,
} from '../../../application/errors/users.errors.js';

type UsersApplicationError =
  | EmailAlreadyExistsError
  | UserUnavailableError
  | EmptyProfileUpdateError
  | InvalidFullNameError
  | AccountChangedError
  | AdminRequiredError
  | IncorrectPasswordError
  | InvalidAccountInputError
  | LastAdminError
  | UserNotFoundError;

@Catch(
  EmailAlreadyExistsError,
  UserUnavailableError,
  EmptyProfileUpdateError,
  InvalidFullNameError,
  AccountChangedError,
  AdminRequiredError,
  IncorrectPasswordError,
  InvalidAccountInputError,
  LastAdminError,
  UserNotFoundError,
)
export class UsersExceptionFilter implements ExceptionFilter<UsersApplicationError> {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: UsersApplicationError, host: ArgumentsHost): void {
    let statusCode = HttpStatus.BAD_REQUEST;
    let error = 'Bad Request';
    if (
      exception instanceof UserUnavailableError ||
      exception instanceof IncorrectPasswordError
    ) {
      statusCode = HttpStatus.UNAUTHORIZED;
      error = 'Unauthorized';
    } else if (exception instanceof AdminRequiredError) {
      statusCode = HttpStatus.FORBIDDEN;
      error = 'Forbidden';
    } else if (exception instanceof UserNotFoundError) {
      statusCode = HttpStatus.NOT_FOUND;
      error = 'Not Found';
    } else if (
      exception instanceof AccountChangedError ||
      exception instanceof EmailAlreadyExistsError ||
      exception instanceof LastAdminError
    ) {
      statusCode = HttpStatus.CONFLICT;
      error = 'Conflict';
    }

    this.httpAdapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode,
        message: exception.message,
        error,
        // All UsersApplicationError subclasses now have a readonly code property.
        code: (exception as { code: string }).code,
      },
      statusCode,
    );
  }
}
