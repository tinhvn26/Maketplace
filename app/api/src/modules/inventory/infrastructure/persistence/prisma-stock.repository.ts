import { Prisma } from '../../../../platform/database/generated/client.js';
import type { InventoryStock as PrismaStock } from '../../../../platform/database/generated/client.js';
import type {
  StockCandidate,
  StockRepository,
  StockScopeFilter,
} from '../../application/ports/stock.repository.js';
import type { Stock } from '../../domain/entities/stock.js';
import type {
  StockMovement,
  StockMovementRecord,
  StockMovementType,
} from '../../domain/entities/stock-movement.js';
import { InventoryVersionConflictError } from '../../domain/errors/inventory.errors.js';
import { translateStorageError } from './prisma-errors.js';
import type { InventoryDatabase } from './prisma-warehouse.repository.js';

const MOVEMENT_TYPES: readonly string[] = [
  'RECEIPT',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RESERVE',
  'RELEASE',
  'EXPIRE',
  'SHIP',
] satisfies StockMovementType[];

export class PrismaStockRepository implements StockRepository {
  constructor(private readonly db: InventoryDatabase) {}

  async findByKey(warehouseId: string, variantId: string) {
    const row = await this.db.inventoryStock.findUnique({
      where: { warehouseId_variantId: { warehouseId, variantId } },
    });
    return row ? this.toStock(row) : null;
  }

  async findByIds(ids: readonly string[]) {
    const rows = await this.db.inventoryStock.findMany({
      where: { id: { in: [...ids] } },
    });
    return rows.map((row) => this.toStock(row));
  }

  async insert(stock: Stock): Promise<void> {
    try {
      await this.db.inventoryStock.create({ data: stock });
    } catch (error) {
      // A concurrent insert of the same (warehouse, variant) is a lost race: re-read and retry.
      translateStorageError(error);
    }
  }

  async save(stock: Stock, expectedVersion: number): Promise<Stock> {
    const updated = await this.db.inventoryStock.updateMany({
      where: { id: stock.id, version: expectedVersion },
      data: {
        onHand: stock.onHand,
        reserved: stock.reserved,
        updatedAt: stock.updatedAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new InventoryVersionConflictError();
    return this.toStock(
      await this.db.inventoryStock.findUniqueOrThrow({ where: { id: stock.id } }),
    );
  }

  async findCandidates(variantIds: readonly string[]): Promise<StockCandidate[]> {
    const rows = await this.db.inventoryStock.findMany({
      where: { variantId: { in: [...variantIds] } },
      include: { warehouse: { select: { priority: true, isActive: true } } },
    });
    return rows.map(({ warehouse, ...row }) => {
      const stock = this.toStock(row);
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
  }

  async list(filter: StockScopeFilter) {
    const where = this.scope(filter);
    const [rows, total] = await Promise.all([
      this.db.inventoryStock.findMany({
        where,
        orderBy: [{ variantId: 'asc' }, { warehouseId: 'asc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.db.inventoryStock.count({ where }),
    ]);
    return { items: rows.map((row) => this.toStock(row)), total };
  }

  async appendMovements(movements: readonly StockMovement[]): Promise<void> {
    if (movements.length === 0) return;
    await this.db.inventoryMovement.createMany({ data: [...movements] });
  }

  async listMovements(filter: StockScopeFilter) {
    const where: Prisma.InventoryMovementWhereInput = { stock: this.scope(filter) };
    const [rows, total] = await Promise.all([
      this.db.inventoryMovement.findMany({
        where,
        include: { stock: { select: { warehouseId: true, variantId: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.db.inventoryMovement.count({ where }),
    ]);
    const items: StockMovementRecord[] = rows.map(({ stock, type, ...row }) => {
      if (!this.isMovementType(type))
        throw new Error('Unsupported persisted stock movement type');
      return {
        ...row,
        type,
        warehouseId: stock.warehouseId,
        variantId: stock.variantId,
      };
    });
    return { items, total };
  }

  async availability(variantIds: readonly string[]) {
    if (variantIds.length === 0) return [];
    const rows = await this.db.$queryRaw<
      Array<{ variantId: string; available: bigint | number }>
    >(Prisma.sql`
      SELECT s."variantId" AS "variantId", SUM(s."onHand" - s."reserved") AS "available"
      FROM "InventoryStock" s
      JOIN "InventoryWarehouse" w ON w."id" = s."warehouseId"
      WHERE w."isActive" = 1 AND s."variantId" IN (${Prisma.join([...variantIds])})
      GROUP BY s."variantId"
    `);
    return rows.map((row) => ({
      variantId: row.variantId,
      available: Number(row.available),
    }));
  }

  private scope(filter: StockScopeFilter): Prisma.InventoryStockWhereInput {
    return {
      warehouse: { shopId: filter.shopId },
      ...(filter.warehouseId === undefined ? {} : { warehouseId: filter.warehouseId }),
      ...(filter.variantId === undefined ? {} : { variantId: filter.variantId }),
    };
  }

  private isMovementType(value: string): value is StockMovementType {
    return MOVEMENT_TYPES.includes(value);
  }

  private toStock(row: PrismaStock): Stock {
    return { ...row };
  }
}
