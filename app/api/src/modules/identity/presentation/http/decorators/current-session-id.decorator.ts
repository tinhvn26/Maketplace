import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/access-token.guard.js';

export const CurrentSessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const sessionId = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().sessionId;
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new UnauthorizedException('An authenticated session is required');
    }
    return sessionId;
  },
);
