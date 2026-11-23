import type { Stock } from '../../domain/entities/stock.js';
import type {
  StockMovement,
  StockMovementRecord,
} from '../../domain/entities/stock-movement.js';
import type { AllocationCandidate } from '../../domain/policies/stock-allocation.policy.js';

export interface StockCandidate extends AllocationCandidate {
  stock: Stock;
}

export interface StockScopeFilter {
  /** null = platform warehouses. */
  shopId: string | null;
  warehouseId?: string;
  variantId?: string;
  page: number;
  limit: number;
}

export interface StockRepository {
  findByKey(warehouseId: string, variantId: string): Promise<Stock | null>;
  findByIds(ids: readonly string[]): Promise<Stock[]>;
  /** A concurrent insert of the same (warehouse, variant) rejects with InventoryVersionConflictError. */
  insert(stock: Stock): Promise<void>;
  /** Compare-and-set on version; rejects with InventoryVersionConflictError when it lost. */
  save(stock: Stock, expectedVersion: number): Promise<Stock>;
  /** Every stock row for these variants, with its warehouse's priority and state. */
  findCandidates(variantIds: readonly string[]): Promise<StockCandidate[]>;
  list(filter: StockScopeFilter): Promise<{ items: Stock[]; total: number }>;
  appendMovements(movements: readonly StockMovement[]): Promise<void>;
  listMovements(
    filter: StockScopeFilter,
  ): Promise<{ items: StockMovementRecord[]; total: number }>;
  /** Units available in active warehouses; variants without stock are omitted. */
  availability(
    variantIds: readonly string[],
  ): Promise<Array<{ variantId: string; available: number }>>;
}
