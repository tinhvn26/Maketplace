import { UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../identity/contracts/identity.http.js';
import type {
  CatalogActor,
  CatalogMutationContext,
} from '../../application/ports/catalog-actor.js';
import { isUserRole } from '../../../identity/contracts/identity.roles.js';

export function catalogActor(request: AuthenticatedRequest): CatalogActor {
  if (!request.userId || !isUserRole(request.role))
    throw new UnauthorizedException();
  return { userId: request.userId, role: request.role };
}
export function catalogContext(
  request: AuthenticatedRequest,
  action: string,
): CatalogMutationContext {
  return { actor: catalogActor(request), action };
}
