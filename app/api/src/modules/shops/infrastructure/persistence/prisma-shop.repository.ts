import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import {
  findActiveAccount,
  lockAccount,
} from '../../../identity/contracts/identity.persistence.js';
import type { ShopActor } from '../../contracts/shops.api.js';
import type {
  ShopRepository,
  ShopStore,
  ShopWithOwnerState,
} from '../../application/ports/shop.repository.js';
import type { Shop } from '../../domain/entities/shop.js';
import type { ShopAccount } from '../../domain/policies/shop-access.policy.js';
import {
  ShopAccessDeniedError,
  ShopConflictError,
  ShopVersionConflictError,
} from '../../domain/errors/shop.errors.js';
import { findShopsWithOwnerState, toShop } from './shop.persistence.js';

type Database = Prisma.TransactionClient;

class PrismaShopStore implements ShopStore {
  constructor(private readonly db: Database) {}

  findActiveAccount(actor: ShopActor): Promise<ShopAccount | null> {
    return findActiveAccount(this.db, actor);
  }

  async findById(id: string): Promise<Shop | null> {
    const shop = await this.db.shop.findUnique({ where: { id } });
    return shop ? toShop(shop) : null;
  }

  async findWithOwnerState(id: string): Promise<ShopWithOwnerState | null> {
    return (await findShopsWithOwnerState(this.db, [id]))[0] ?? null;
  }

  findManyWithOwnerState(
    ids: readonly string[],
  ): Promise<ShopWithOwnerState[]> {
    return findShopsWithOwnerState(this.db, ids);
  }

  async listByOwner(ownerId: string): Promise<Shop[]> {
    const shops = await this.db.shop.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return shops.map(toShop);
  }

  async insert(shop: Shop): Promise<Shop> {
    return toShop(await this.db.shop.create({ data: shop }));
  }

  save(shop: Shop, expectedVersion: number): Promise<Shop> {
    return this.compareAndSet(shop.id, expectedVersion, {
      name: shop.name,
      slug: shop.slug,
      updatedAt: shop.updatedAt,
    });
  }

  saveStatus(shop: Shop, expectedVersion: number): Promise<Shop> {
    return this.compareAndSet(shop.id, expectedVersion, {
      status: shop.status,
      updatedAt: shop.updatedAt,
    });
  }

  private async compareAndSet(
    id: string,
    expectedVersion: number,
    data: Prisma.ShopUpdateManyMutationInput,
  ): Promise<Shop> {
    const updated = await this.db.shop.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ShopVersionConflictError();
    return toShop(await this.db.shop.findUniqueOrThrow({ where: { id } }));
  }
}

@Injectable()
export class PrismaShopRepository
  extends PrismaShopStore
  implements ShopRepository
{
  constructor(private readonly prisma: PrismaService) {
    super(prisma);
  }

  async transaction<T>(
    actorId: string,
    work: (store: ShopStore) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await lockAccount(tx, actorId);
          return work(new PrismaShopStore(tx));
        });
      } catch (error) {
        const record = (value: unknown): Record<string, unknown> | undefined =>
          typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)
            : undefined;
        const code = record(error)?.code;
        const cause = record(
          record(record(error)?.meta)?.driverAdapterError,
        )?.cause;
        const sqliteCode = record(cause)?.originalCode;
        if (sqliteCode === 'SQLITE_BUSY' || sqliteCode === 'SQLITE_LOCKED') {
          if (attempt < 2) {
            await delay(0);
            continue;
          }
          throw new ShopConflictError(
            'Shop storage is busy; retry the operation',
          );
        }
        if (code === 'P2002')
          throw new ShopConflictError('Shop slug is already in use');
        if (code === 'P2003')
          throw new ShopAccessDeniedError('An active shop owner is required');
        throw error;
      }
    }
  }
}
