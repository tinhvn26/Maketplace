import { InventoryVersionConflictError } from '../../domain/errors/inventory.errors.js';

/** Re-runs a whole unit of work when a compare-and-set lost to a concurrent writer. */
export async function retryOnConflict<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof InventoryVersionConflictError) || attempt >= attempts)
        throw error;
    }
  }
}
