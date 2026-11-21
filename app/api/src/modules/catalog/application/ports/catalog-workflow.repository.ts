import type { ProductSnapshot } from '../../domain/entities/product.js';
import type { CatalogMutationContext } from './catalog-actor.js';

export const CATALOG_WORKFLOW = Symbol('CATALOG_WORKFLOW');

export interface CatalogRevision {
  id: string;
  productId: string;
  baseVersion: number;
  version: number;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  snapshot: ProductSnapshot;
  submittedBy: string | null;
  reviewedBy: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerProductState {
  product: ProductSnapshot;
  revision: CatalogRevision | null;
}

export interface CatalogWorkflowRepository {
  load(productId: string, shopId: string): Promise<SellerProductState | null>;

  saveRevision(
    product: ProductSnapshot,
    expectedVersion: number,
    revisionVersion: number | undefined,
    context: CatalogMutationContext,
  ): Promise<SellerProductState>;

  submit(
    productId: string,
    version: number,
    revisionVersion: number | undefined,
    context: CatalogMutationContext,
  ): Promise<SellerProductState>;

  withdraw(
    productId: string,
    version: number,
    revisionVersion: number,
    context: CatalogMutationContext,
  ): Promise<SellerProductState>;

  review(
    id: string,
    version: number,
    approve: boolean,
    note: string | undefined,
    context: CatalogMutationContext,
  ): Promise<CatalogRevision>;

  listReviews(
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    limit: number,
  ): Promise<CatalogRevision[]>;
  
  audit(entityId: string, limit: number): Promise<unknown[]>;
}
