import { describe, expect, it } from 'vitest';
import { InsufficientStockError } from '../errors/inventory.errors.js';
import { allocateStock } from './stock-allocation.policy.js';
import type { AllocationCandidate } from './stock-allocation.policy.js';

const candidate = (
  warehouseId: string,
  available: number,
  warehousePriority = 100,
  warehouseActive = true,
  variantId = 'v1',
): AllocationCandidate => ({
  stockId: `${warehouseId}-${variantId}`,
  warehouseId,
  variantId,
  warehousePriority,
  warehouseActive,
  available,
});

describe('allocateStock', () => {
  it('prefers lower priority, then more available units, then warehouse id', () => {
    const result = allocateStock(
      [{ variantId: 'v1', quantity: 1 }],
      [candidate('b', 5), candidate('a', 5), candidate('c', 9), candidate('z', 1, 1)],
    );
    expect(result).toEqual([
      { stockId: 'z-v1', warehouseId: 'z', variantId: 'v1', quantity: 1 },
    ]);
    expect(
      allocateStock([{ variantId: 'v1', quantity: 1 }], [candidate('b', 5), candidate('a', 5)])[0]
        .warehouseId,
    ).toBe('a');
  });

  it('splits one line across warehouses', () => {
    const result = allocateStock(
      [{ variantId: 'v1', quantity: 7 }],
      [candidate('a', 5, 1), candidate('b', 4, 2)],
    );
    expect(result.map((item) => [item.warehouseId, item.quantity])).toEqual([
      ['a', 5],
      ['b', 2],
    ]);
  });

  it('ignores inactive warehouses, empty stock and other variants', () => {
    expect(() =>
      allocateStock(
        [{ variantId: 'v1', quantity: 2 }],
        [candidate('a', 9, 1, false), candidate('b', 0), candidate('c', 9, 1, true, 'v2'), candidate('d', 1)],
      ),
    ).toThrow(InsufficientStockError);
  });

  it('allocates every line or none', () => {
    expect(() =>
      allocateStock(
        [
          { variantId: 'v1', quantity: 1 },
          { variantId: 'v2', quantity: 1 },
        ],
        [candidate('a', 3)],
      ),
    ).toThrow(InsufficientStockError);
  });
});
