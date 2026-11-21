import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { EmailAlreadyExistsError } from '../../../application/errors/auth.errors.js';
import { UserUnavailableError } from '../../../application/errors/users.errors.js';
import {
  IncorrectAccountPasswordError,
  InvalidAccountActionError,
  InvalidAccountPasswordError,
  InvalidEmailChangeError,
} from '../../../application/errors/account-actions.errors.js';

type AccountActionsError =
  | InvalidAccountActionError
  | IncorrectAccountPasswordError
  | InvalidEmailChangeError
  | InvalidAccountPasswordError
  | UserUnavailableError
  | EmailAlreadyExistsError;

@Catch(
  InvalidAccountActionError,
  IncorrectAccountPasswordError,
  InvalidEmailChangeError,
  InvalidAccountPasswordError,
  UserUnavailableError,
  EmailAlreadyExistsError,
)
export class AccountActionsExceptionFilter implements ExceptionFilter<AccountActionsError> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: AccountActionsError, host: ArgumentsHost): void {
    let statusCode = HttpStatus.BAD_REQUEST;
    let error = 'Bad Request';
    if (exception instanceof EmailAlreadyExistsError) {
      statusCode = HttpStatus.CONFLICT;
      error = 'Conflict';
    } else if (
      exception instanceof IncorrectAccountPasswordError ||
      exception instanceof UserUnavailableError
    ) {
      statusCode = HttpStatus.UNAUTHORIZED;
      error = 'Unauthorized';
    }
    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode,
        message: exception.message,
        error,
        code: (exception as { code: string }).code,
      },
      statusCode,
    );
  }
}
