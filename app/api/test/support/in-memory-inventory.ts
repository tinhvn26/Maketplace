import type {
  InventoryRepositories,
  InventoryUnitOfWork,
} from '../../src/modules/inventory/application/ports/inventory-unit-of-work.js';
import type { Reservation } from '../../src/modules/inventory/domain/entities/reservation.js';
import type { Stock } from '../../src/modules/inventory/domain/entities/stock.js';
import type {
  StockMovement,
  StockMovementRecord,
} from '../../src/modules/inventory/domain/entities/stock-movement.js';
import type { Warehouse } from '../../src/modules/inventory/domain/entities/warehouse.js';
import {
  InventoryConflictError,
  InventoryVersionConflictError,
} from '../../src/modules/inventory/domain/errors/inventory.errors.js';

/** In-memory unit of work with real rollback and compare-and-set semantics. */
export class InMemoryInventory implements InventoryUnitOfWork {
  warehouses = new Map<string, Warehouse>();
  stocks = new Map<string, Stock>();
  reservations = new Map<string, Reservation>();
  movements: StockMovementRecord[] = [];
  /** Runs before every stock save; lets a test simulate a concurrent writer. */
  beforeStockSave?: () => void;
  stockSaves = 0;
  /** What the write transaction sees of Shops and Identity. */
  shops = new Map<string, { ownerId: string; sellable: boolean }>();
  inactiveUsers = new Set<string>();

  async run<T>(work: (tx: InventoryRepositories) => Promise<T>): Promise<T> {
    const before = {
      warehouses: new Map(this.warehouses),
      stocks: new Map(this.stocks),
      reservations: new Map(this.reservations),
      movements: [...this.movements],
    };
    try {
      return await work(this.repositories());
    } catch (error) {
      Object.assign(this, before);
      throw error;
    }
  }

  read<T>(work: (tx: InventoryRepositories) => Promise<T>): Promise<T> {
    return work(this.repositories());
  }

  // `state` defaults to this so the object literals below can refer to it without an alias.
  private repositories(state: InMemoryInventory = this): InventoryRepositories {
    const scoped =
      (shopId: string | null, warehouseId?: string, variantId?: string) =>
      (stock: Stock) =>
        state.warehouses.get(stock.warehouseId)?.shopId === shopId &&
        (warehouseId === undefined || stock.warehouseId === warehouseId) &&
        (variantId === undefined || stock.variantId === variantId);
    const page = <T>(rows: T[], number: number, limit: number) => ({
      items: rows.slice((number - 1) * limit, number * limit),
      total: rows.length,
    });

    return {
      warehouses: {
        async insert(warehouse) {
          for (const other of state.warehouses.values())
            if (
              other.shopId === warehouse.shopId &&
              other.code === warehouse.code
            )
              throw new InventoryConflictError('Warehouse code already exists');
          state.warehouses.set(warehouse.id, warehouse);
        },
        async findById(id) {
          return state.warehouses.get(id) ?? null;
        },
        async listByShop(shopId) {
          return [...state.warehouses.values()].filter(
            (w) => w.shopId === shopId,
          );
        },
        async save(warehouse, expectedVersion) {
          if (state.warehouses.get(warehouse.id)?.version !== expectedVersion)
            throw new InventoryVersionConflictError();
          const saved = { ...warehouse, version: expectedVersion + 1 };
          state.warehouses.set(saved.id, saved);
          return saved;
        },
      },
      stocks: {
        async findByKey(warehouseId, variantId) {
          return (
            [...state.stocks.values()].find(
              (s) => s.warehouseId === warehouseId && s.variantId === variantId,
            ) ?? null
          );
        },
        async findByIds(ids) {
          return ids.flatMap((id) => state.stocks.get(id) ?? []);
        },
        async insert(stock) {
          const exists = [...state.stocks.values()].some(
            (s) =>
              s.warehouseId === stock.warehouseId &&
              s.variantId === stock.variantId,
          );
          if (exists) throw new InventoryVersionConflictError();
          state.stocks.set(stock.id, stock);
        },
        async save(stock, expectedVersion) {
          state.stockSaves++;
          state.beforeStockSave?.();
          if (state.stocks.get(stock.id)?.version !== expectedVersion)
            throw new InventoryVersionConflictError();
          const saved = { ...stock, version: expectedVersion + 1 };
          state.stocks.set(saved.id, saved);
          return saved;
        },
        async findCandidates(variantIds) {
          return [...state.stocks.values()]
            .filter((s) => variantIds.includes(s.variantId))
            .map((stock) => {
              const warehouse = state.warehouses.get(stock.warehouseId)!;
              return {
                stockId: stock.id,
                warehouseId: stock.warehouseId,
                variantId: stock.variantId,
                warehousePriority: warehouse.priority,
                warehouseActive: warehouse.isActive,
                available: stock.onHand - stock.reserved,
                stock,
              };
            });
        },
        async list(f) {
          return page(
            [...state.stocks.values()].filter(
              scoped(f.shopId, f.warehouseId, f.variantId),
            ),
            f.page,
            f.limit,
          );
        },
        async appendMovements(movements: readonly StockMovement[]) {
          for (const movement of movements) {
            const stock = state.stocks.get(movement.stockId)!;
            state.movements.push({
              ...movement,
              id: `m${state.movements.length + 1}`,
              warehouseId: stock.warehouseId,
              variantId: stock.variantId,
            });
          }
        },
        async listMovements(f) {
          const matches = scoped(f.shopId, f.warehouseId, f.variantId);
          return page(
            state.movements
              .filter((m) => matches(state.stocks.get(m.stockId)!))
              .reverse(),
            f.page,
            f.limit,
          );
        },
        async availability(variantIds) {
          const totals = new Map<string, number>();
          for (const stock of state.stocks.values()) {
            if (
              !variantIds.includes(stock.variantId) ||
              !state.warehouses.get(stock.warehouseId)?.isActive
            )
              continue;
            totals.set(
              stock.variantId,
              (totals.get(stock.variantId) ?? 0) +
                stock.onHand -
                stock.reserved,
            );
          }
          return [...totals].map(([variantId, available]) => ({
            variantId,
            available,
          }));
        },
      },
      reservations: {
        async findById(id) {
          return state.reservations.get(id) ?? null;
        },
        async findByIdempotencyKey(key) {
          return (
            [...state.reservations.values()].find(
              (r) => r.idempotencyKey === key,
            ) ?? null
          );
        },
        async insert(reservation) {
          const exists = [...state.reservations.values()].some(
            (r) => r.idempotencyKey === reservation.idempotencyKey,
          );
          if (exists) throw new InventoryVersionConflictError();
          state.reservations.set(reservation.id, reservation);
        },
        async save(reservation, expectedVersion) {
          if (
            state.reservations.get(reservation.id)?.version !== expectedVersion
          )
            throw new InventoryVersionConflictError();
          const saved = { ...reservation, version: expectedVersion + 1 };
          state.reservations.set(saved.id, saved);
          return saved;
        },
        async findExpiredIds(now, limit) {
          return [...state.reservations.values()]
            .filter(
              (r) =>
                r.status === 'ACTIVE' &&
                r.expiresAt !== null &&
                r.expiresAt.getTime() <= now.getTime(),
            )
            .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
            .slice(0, limit)
            .map((r) => r.id);
        },
      },
      access: {
        async isActiveAccount(actor) {
          return !state.inactiveUsers.has(actor.userId);
        },
        async findShopState(shopId) {
          return state.shops.get(shopId) ?? null;
        },
      },
    };
  }
}
