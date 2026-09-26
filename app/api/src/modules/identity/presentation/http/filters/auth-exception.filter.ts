import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  InvalidCredentialsError,
  InvalidFullNameError,
  InvalidRefreshTokenError,
} from '../../../application/auth/auth.errors.js';
import { EmailAlreadyExistsError } from '../../../application/ports/user.repository.js';

type AuthApplicationError =
  | InvalidCredentialsError
  | InvalidRefreshTokenError
  | InvalidFullNameError
  | EmailAlreadyExistsError;

@Catch(
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidFullNameError,
  EmailAlreadyExistsError,
)
export class AuthExceptionFilter implements ExceptionFilter<AuthApplicationError> {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: AuthApplicationError, host: ArgumentsHost): void {
    let statusCode = HttpStatus.UNAUTHORIZED;
    let error = 'Unauthorized';
    let message = exception.message;

    if (exception instanceof EmailAlreadyExistsError) {
      statusCode = HttpStatus.CONFLICT;
      error = 'Conflict';
      message = 'Email đã được sử dụng';
    } else if (exception instanceof InvalidFullNameError) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'Bad Request';
    }

    this.httpAdapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      { statusCode, message, error },
      statusCode,
    );
  }
}
