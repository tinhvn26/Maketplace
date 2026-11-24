import type { CatalogActor } from '../ports/catalog-actor.js';
import type { CatalogWorkflowRepository } from '../ports/catalog-workflow.repository.js';
import { CatalogNotFoundError } from '../../domain/errors/catalog.errors.js';

export class CatalogReviewService {
  constructor(private readonly workflow: CatalogWorkflowRepository) {}

  list(
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    limit: number,
    actor: CatalogActor,
  ) {
    this.admin(actor);
    return this.workflow.listReviews(status, limit);
  }

  decide(
    id: string,
    version: number,
    approve: boolean,
    note: string | undefined,
    actor: CatalogActor,
  ) {
    this.admin(actor);
    return this.workflow.review(id, version, approve, note, {
      actor,
      action: approve ? 'APPROVE_REVIEW' : 'REJECT_REVIEW',
    });
  }

  audit(id: string, limit: number, actor: CatalogActor) {
    this.admin(actor);
    return this.workflow.audit(id, limit);
  }

  private admin(actor: CatalogActor) {
    if (actor.role !== 'ADMIN')
      throw new CatalogNotFoundError('Review not found');
  }
}
