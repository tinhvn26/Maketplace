import type {
  InventoryWarehouse as PrismaWarehouse,
  Prisma,
} from '../../../../platform/database/generated/client.js';
import type { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { WarehouseRepository } from '../../application/ports/warehouse.repository.js';
import type { Warehouse } from '../../domain/entities/warehouse.js';
import {
  InventoryConflictError,
  InventoryVersionConflictError,
} from '../../domain/errors/inventory.errors.js';
import { translateStorageError } from './prisma-errors.js';

export type InventoryDatabase = PrismaService | Prisma.TransactionClient;

export class PrismaWarehouseRepository implements WarehouseRepository {
  constructor(private readonly db: InventoryDatabase) {}

  async insert(warehouse: Warehouse): Promise<void> {
    try {
      await this.db.inventoryWarehouse.create({ data: warehouse });
    } catch (error) {
      translateStorageError(
        error,
        () => new InventoryConflictError('Warehouse code is already in use'),
      );
    }
  }

  async findById(id: string): Promise<Warehouse | null> {
    const row = await this.db.inventoryWarehouse.findUnique({ where: { id } });
    return row ? this.toWarehouse(row) : null;
  }

  async listByShop(shopId: string | null): Promise<Warehouse[]> {
    const rows = await this.db.inventoryWarehouse.findMany({
      where: { shopId },
      orderBy: [{ priority: 'asc' }, { code: 'asc' }],
    });
    return rows.map((row) => this.toWarehouse(row));
  }

  async save(
    warehouse: Warehouse,
    expectedVersion: number,
  ): Promise<Warehouse> {
    const updated = await this.db.inventoryWarehouse.updateMany({
      where: { id: warehouse.id, version: expectedVersion },
      data: {
        name: warehouse.name,
        priority: warehouse.priority,
        isActive: warehouse.isActive,
        updatedAt: warehouse.updatedAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new InventoryVersionConflictError();
    return this.toWarehouse(
      await this.db.inventoryWarehouse.findUniqueOrThrow({
        where: { id: warehouse.id },
      }),
    );
  }

  private toWarehouse(row: PrismaWarehouse): Warehouse {
    return { ...row };
  }
}
