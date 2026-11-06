import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  Prisma,
  Shop as PrismaShop,
} from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { ShopActor } from '../../contracts/shops.api.js';
import type { ShopRepository } from '../../application/ports/shop.repository.js';
import type { Shop } from '../../domain/entities/shop.js';
import { shopId } from '../../domain/entities/shop.js';
import {
  ShopAccessDeniedError,
  ShopConflictError,
  ShopNotFoundError,
  ShopUnavailableError,
  ShopVersionConflictError,
} from '../../domain/errors/shop.errors.js';
import {
  isActiveShopAccount,
  mayManageShop,
} from '../../domain/policies/shop-access.policy.js';

type Database = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PrismaShopRepository implements ShopRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(shop: Shop, actor: ShopActor): Promise<Shop> {
    return this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockActor(tx, actor);
        const user = await this.actor(tx, actor);
        if (shop.ownerId !== user.id) throw new ShopAccessDeniedError();
        return this.toShop(await tx.shop.create({ data: shop }));
      }),
    );
  }

  async listMine(actor: ShopActor): Promise<Shop[]> {
    const user = await this.actor(this.prisma, actor);
    const shops = await this.prisma.shop.findMany({
      where: { ownerId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return shops.map((shop) => this.toShop(shop));
  }

  async findPublicById(id: string): Promise<Shop | null> {
    const shop = await this.prisma.shop.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        owner: {
          status: 'ACTIVE',
          deletedAt: null,
          role: { in: ['USER', 'ADMIN'] },
        },
      },
    });
    return shop ? this.toShop(shop) : null;
  }

  async findById(id: string): Promise<Shop | null> {
    const shop = await this.prisma.shop.findUnique({ where: { id } });
    return shop ? this.toShop(shop) : null;
  }

  async requireManageable(id: string, actor: ShopActor): Promise<void> {
    await this.managedShop(this.prisma, shopId(id), actor);
  }

  async assertSellable(ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids.map(shopId))];
    if (unique.length === 0) return;
    const shops = await this.prisma.shop.findMany({
      where: {
        id: { in: unique },
        status: 'ACTIVE',
        owner: {
          status: 'ACTIVE',
          deletedAt: null,
          role: { in: ['USER', 'ADMIN'] },
        },
      },
      select: { id: true },
    });
    if (shops.length !== unique.length) throw new ShopUnavailableError();
  }

  async requireAdministrator(actor: ShopActor): Promise<void> {
    const user = await this.actor(this.prisma, actor);
    if (user.role !== 'ADMIN')
      throw new ShopAccessDeniedError('Administrator access is required');
  }

  save(shop: Shop, expectedVersion: number, actor: ShopActor): Promise<Shop> {
    return this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockActor(tx, actor);
        const current = await this.managedShop(tx, shop.id, actor);
        const updated = await tx.shop.updateMany({
          where: {
            id: current.id,
            version: expectedVersion,
            ownerId: current.ownerId,
            status: 'ACTIVE',
          },
          data: {
            name: shop.name,
            slug: shop.slug,
            updatedAt: shop.updatedAt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new ShopVersionConflictError();
        return this.toShop(
          await tx.shop.findUniqueOrThrow({ where: { id: shop.id } }),
        );
      }),
    );
  }

  saveStatus(
    shop: Shop,
    expectedVersion: number,
    actor: ShopActor,
  ): Promise<Shop> {
    return this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockActor(tx, actor);
        const user = await this.actor(tx, actor);
        if (user.role !== 'ADMIN')
          throw new ShopAccessDeniedError('Administrator access is required');
        const updated = await tx.shop.updateMany({
          where: { id: shop.id, version: expectedVersion },
          data: {
            status: shop.status,
            updatedAt: shop.updatedAt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          if (
            !(await tx.shop.findUnique({
              where: { id: shop.id },
              select: { id: true },
            }))
          )
            throw new ShopNotFoundError();
          throw new ShopVersionConflictError();
        }
        return this.toShop(
          await tx.shop.findUniqueOrThrow({ where: { id: shop.id } }),
        );
      }),
    );
  }

  private async managedShop(db: Database, id: string, actor: ShopActor) {
    const user = await this.actor(db, actor);
    const shop = await db.shop.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, role: true, status: true, deletedAt: true },
        },
      },
    });
    if (!shop) throw new ShopNotFoundError();
    if (!mayManageShop(shop.ownerId, user)) throw new ShopAccessDeniedError();
    if (shop.status !== 'ACTIVE' || !isActiveShopAccount(shop.owner))
      throw new ShopUnavailableError();
    return shop;
  }

  private async actor(db: Database, actor: ShopActor) {
    const user = await db.user.findUnique({
      where: { id: shopId(actor.userId) },
      select: { id: true, role: true, status: true, deletedAt: true },
    });
    if (!isActiveShopAccount(user) || user.role !== actor.role)
      throw new ShopAccessDeniedError();
    return user;
  }

  private async lockActor(
    tx: Prisma.TransactionClient,
    actor: ShopActor,
  ): Promise<void> {
    await tx.$executeRaw`UPDATE "User" SET "authVersion" = "authVersion" WHERE "id" = ${shopId(actor.userId)}`;
  }

  private toShop(shop: PrismaShop): Shop {
    if (shop.status !== 'ACTIVE' && shop.status !== 'SUSPENDED')
      throw new Error('Unsupported persisted shop status');
    return { ...shop, status: shop.status };
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
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
