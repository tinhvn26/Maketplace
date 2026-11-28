import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { isUserRole } from '../../../../identity/contracts/identity.roles.js';
import type { OrderActor } from '../../../application/ports/order-unit-of-work.js';

/** Reads the actor resolved by AccessTokenGuard; the role is the live one, not the token's. */
export const CurrentOrderActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrderActor => {
    const request = context
      .switchToHttp()
      .getRequest<{ userId?: string; role?: OrderActor['role'] }>();
    if (!request.userId || !isUserRole(request.role))
      throw new UnauthorizedException();
    return { userId: request.userId, role: request.role };
  },
);
