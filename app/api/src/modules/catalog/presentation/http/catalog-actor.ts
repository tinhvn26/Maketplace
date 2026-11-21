import { UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../identity/presentation/http/guards/access-token.guard.js';
import type {
  CatalogActor,
  CatalogMutationContext,
} from '../../application/ports/catalog-actor.js';

export function catalogActor(request: AuthenticatedRequest): CatalogActor {
  if (
    !request.userId ||
    (request.role !== 'ADMIN' &&
      request.role !== 'EMPLOYER' &&
      request.role !== 'CUSTOMER')
  )
    throw new UnauthorizedException();
  return { userId: request.userId, role: request.role };
}
export function catalogContext(
  request: AuthenticatedRequest,
  action: string,
): CatalogMutationContext {
  return { actor: catalogActor(request), action };
}
