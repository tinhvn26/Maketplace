import type { InventoryAccessReader } from './inventory-access.reader.js';
import type { ReservationRepository } from './reservation.repository.js';
import type { StockRepository } from './stock.repository.js';
import type { WarehouseRepository } from './warehouse.repository.js';

export const INVENTORY_UNIT_OF_WORK = Symbol('INVENTORY_UNIT_OF_WORK');

export interface InventoryRepositories {
  warehouses: WarehouseRepository;
  stocks: StockRepository;
  reservations: ReservationRepository;
  access: InventoryAccessReader;
}

export interface InventoryUnitOfWork {
  /** One atomic transaction; everything written inside commits or rolls back together. */
  run<T>(work: (repositories: InventoryRepositories) => Promise<T>): Promise<T>;
  /** Read-only access without taking the write lock. */
  read<T>(
    work: (repositories: InventoryRepositories) => Promise<T>,
  ): Promise<T>;
}
