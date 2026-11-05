import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './access-token.guard.js';

/** Must run after AccessTokenGuard, which resolves the account's live role. */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.role !== 'ADMIN') {
      throw new ForbiddenException('Administrator access is required');
    }
    return true;
  }
}
