import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import { findActiveAccount } from '../../../identity/contracts/identity.persistence.js';
import { findShopState } from '../../../shops/contracts/shops.persistence.js';
import type {
  OrderRepositories,
  OrderUnitOfWork,
} from '../../application/ports/order-unit-of-work.js';
import {
  OrderConflictError,
  OrderVersionConflictError,
} from '../../domain/errors/order.errors.js';
import { PrismaOrderStore } from './prisma-order.store.js';

function repositories(
  db: PrismaService | Prisma.TransactionClient,
): OrderRepositories {
  return {
    orders: new PrismaOrderStore(db),
    access: {
      isActiveAccount: async (actor) =>
        (await findActiveAccount(db, actor)) !== null,
      findShopState: (shopId) => findShopState(db, shopId),
    },
  };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

@Injectable()
export class PrismaOrderUnitOfWork implements OrderUnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(work: (tx: OrderRepositories) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Take SQLite's write lock first so a concurrent checkout's commit is
        // visible to the idempotency lookup instead of failing at first write.
        await tx.$executeRaw`UPDATE "Order" SET "version" = "version" WHERE "id" = ''`;
        return work(repositories(tx));
      });
    } catch (error) {
      const driver = record(
        record(record(record(error)?.meta)?.driverAdapterError)?.cause,
      );
      if (
        driver?.originalCode === 'SQLITE_BUSY' ||
        driver?.originalCode === 'SQLITE_LOCKED'
      )
        throw new OrderVersionConflictError('Order storage is busy');
      // A unique violation no store translated must surface as 409, not 500.
      if (record(error)?.code === 'P2002') throw new OrderConflictError();
      throw error;
    }
  }

  read<T>(work: (tx: OrderRepositories) => Promise<T>): Promise<T> {
    return work(repositories(this.prisma));
  }
}
