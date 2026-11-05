import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  InvalidFullNameError,
  InvalidRefreshTokenError,
  InvalidRegistrationInputError,
} from '../../../application/errors/auth.errors.js';

type AuthApplicationError =
  | InvalidCredentialsError
  | InvalidRefreshTokenError
  | InvalidFullNameError
  | InvalidRegistrationInputError
  | EmailAlreadyExistsError;

@Catch(
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidFullNameError,
  InvalidRegistrationInputError,
  EmailAlreadyExistsError,
)
export class AuthExceptionFilter implements ExceptionFilter<AuthApplicationError> {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: AuthApplicationError, host: ArgumentsHost): void {
    let statusCode = HttpStatus.UNAUTHORIZED;
    let error = 'Unauthorized';

    if (exception instanceof EmailAlreadyExistsError) {
      statusCode = HttpStatus.CONFLICT;
      error = 'Conflict';
    } else if (
      exception instanceof InvalidFullNameError ||
      exception instanceof InvalidRegistrationInputError
    ) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'Bad Request';
    }

    this.httpAdapterHost.httpAdapter.reply(
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
