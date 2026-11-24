import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ShopActor } from '../../../contracts/shops.api.js';
import { isUserRole } from '../../../../identity/contracts/identity.roles.js';

export const CurrentShopActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ShopActor => {
    const request = context
      .switchToHttp()
      .getRequest<{ userId?: string; role?: ShopActor['role'] }>();
    if (!request.userId || !isUserRole(request.role))
      throw new UnauthorizedException();
    return { userId: request.userId, role: request.role };
  },
);
