export interface CatalogActor {
  userId: string;
  role: 'ADMIN' | 'EMPLOYER' | 'CUSTOMER';
}

export interface CatalogMutationContext {
  actor: CatalogActor;
  action: string;
  /** A supplied scope must be checked again inside the persistence transaction. */
  shopId?: string;
}
