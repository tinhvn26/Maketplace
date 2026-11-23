import { InventoryValidationError } from '../../domain/errors/inventory.errors.js';
import { inventoryId } from '../../domain/policies/inventory-input.policy.js';
import type { InventoryUnitOfWork } from '../ports/inventory-unit-of-work.js';

const MAX_VARIANTS = 100;

/** Public stock signal; never reveals quantities. */
export class InventoryAvailabilityService {
  constructor(private readonly unitOfWork: InventoryUnitOfWork) {}

  async check(
    variantIds: readonly string[],
  ): Promise<Array<{ variantId: string; inStock: boolean }>> {
    if (!Array.isArray(variantIds) || variantIds.length < 1)
      throw new InventoryValidationError('At least one variant is required');
    const ids = [
      ...new Set(variantIds.map((id) => inventoryId(id, 'variant identifier'))),
    ];
    if (ids.length > MAX_VARIANTS)
      throw new InventoryValidationError(
        `At most ${MAX_VARIANTS} variants can be checked at once`,
      );
    const rows = await this.unitOfWork.read((tx) => tx.stocks.availability(ids));
    const available = new Map(rows.map((row) => [row.variantId, row.available]));
    return ids.map((variantId) => ({
      variantId,
      inStock: (available.get(variantId) ?? 0) > 0,
    }));
  }
}
