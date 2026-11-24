import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type {
  InventoryRepositories,
  InventoryUnitOfWork,
} from '../../application/ports/inventory-unit-of-work.js';
import { InventoryConflictError } from '../../domain/errors/inventory.errors.js';
import { translateStorageError } from './prisma-errors.js';
import { PrismaReservationRepository } from './prisma-reservation.repository.js';
import { PrismaStockRepository } from './prisma-stock.repository.js';
import {
  PrismaWarehouseRepository,
  type InventoryDatabase,
} from './prisma-warehouse.repository.js';

function repositories(db: InventoryDatabase): InventoryRepositories {
  return {
    warehouses: new PrismaWarehouseRepository(db),
    stocks: new PrismaStockRepository(db),
    reservations: new PrismaReservationRepository(db),
  };
}

@Injectable()
export class PrismaInventoryUnitOfWork implements InventoryUnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    work: (repositories: InventoryRepositories) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Take SQLite's write lock before reading, so concurrent writers queue here
        // instead of failing at their first write on a stale snapshot.
        await tx.$executeRaw`UPDATE "InventoryReservation" SET "version" = "version" WHERE "id" = ''`;
        return work(repositories(tx));
      });
    } catch (error) {
      // A unique violation no repository translated must surface as 409, not 500.
      return translateStorageError(error, () => new InventoryConflictError());
    }
  }

  read<T>(
    work: (repositories: InventoryRepositories) => Promise<T>,
  ): Promise<T> {
    return work(repositories(this.prisma));
  }
}
