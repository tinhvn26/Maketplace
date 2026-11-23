import type { Warehouse } from '../../domain/entities/warehouse.js';

export interface WarehouseRepository {
  /** Rejects a duplicate code within the same shop (or the platform) with InventoryConflictError. */
  insert(warehouse: Warehouse): Promise<void>;
  findById(id: string): Promise<Warehouse | null>;
  /** shopId null lists platform warehouses. */
  listByShop(shopId: string | null): Promise<Warehouse[]>;
  /** Compare-and-set on version; rejects with InventoryVersionConflictError when it lost. */
  save(warehouse: Warehouse, expectedVersion: number): Promise<Warehouse>;
}
