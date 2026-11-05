import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/access-token.guard.js';

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const userId = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().userId;

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      throw new UnauthorizedException('An authenticated user is required');
    }

    return userId;
  },
);
