import type { UserRole } from '../../../identity/contracts/identity.roles.js';

export interface CatalogActor {
  userId: string;
  role: UserRole;
}

export interface CatalogMutationContext {
  actor: CatalogActor;
  action: string;
  /** A supplied scope must be checked again inside the persistence transaction. */
  shopId?: string;
}
