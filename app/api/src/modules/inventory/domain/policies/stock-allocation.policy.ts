import { InsufficientStockError } from '../errors/inventory.errors.js';

export interface AllocationCandidate {
  stockId: string;
  warehouseId: string;
  variantId: string;
  warehousePriority: number;
  warehouseActive: boolean;
  available: number;
}

export interface StockAllocation {
  stockId: string;
  warehouseId: string;
  variantId: string;
  quantity: number;
}

/**
 * Splits each line across active warehouses: lowest priority value first, then
 * the warehouse with the most available units, then warehouse id for stable
 * ordering. All lines are allocated or none are.
 */
export function allocateStock(
  lines: ReadonlyArray<{ variantId: string; quantity: number }>,
  candidates: readonly AllocationCandidate[],
): StockAllocation[] {
  const allocations: StockAllocation[] = [];
  for (const line of lines) {
    const options = candidates
      .filter(
        (candidate) =>
          candidate.variantId === line.variantId &&
          candidate.warehouseActive &&
          candidate.available > 0,
      )
      .sort(
        (a, b) =>
          a.warehousePriority - b.warehousePriority ||
          b.available - a.available ||
          a.warehouseId.localeCompare(b.warehouseId),
      );
    let remaining = line.quantity;
    for (const option of options) {
      if (remaining === 0) break;
      const quantity = Math.min(remaining, option.available);
      allocations.push({
        stockId: option.stockId,
        warehouseId: option.warehouseId,
        variantId: option.variantId,
        quantity,
      });
      remaining -= quantity;
    }
    if (remaining > 0)
      throw new InsufficientStockError(
        `Not enough stock is available for variant ${line.variantId}`,
      );
  }
  return allocations;
}
