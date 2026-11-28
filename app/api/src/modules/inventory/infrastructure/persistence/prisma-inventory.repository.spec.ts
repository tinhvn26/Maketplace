import 'reflect-metadata';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import { InventoryAvailabilityService } from '../../application/availability/inventory-availability.service.js';
import { InventoryReservationService } from '../../application/reservations/inventory-reservation.service.js';
import { InventoryStockService } from '../../application/stock/inventory-stock.service.js';
import { InventoryWarehouseService } from '../../application/warehouses/inventory-warehouse.service.js';
import { createStock } from '../../domain/entities/stock.js';
import { createWarehouse } from '../../domain/entities/warehouse.js';
import {
  InsufficientStockError,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryVersionConflictError,
} from '../../domain/errors/inventory.errors.js';
import { PrismaInventoryUnitOfWork } from './prisma-inventory-unit-of-work.js';

describe('Prisma inventory adapters', () => {
  let prisma: PrismaService;
  let unitOfWork: PrismaInventoryUnitOfWork;
  let directory: string;
  let clockNow: Date;
  const seller = { userId: 'owner', role: 'EMPLOYER' as const };
  const start = new Date('2026-11-22T00:00:00.000Z');
  const quote = vi.fn(async () => ({}));
  const shops = {
    requireManageable: vi.fn(async () => undefined),
    assertSellable: vi.fn(),
  };
  const ids = { next: () => randomUUID() };
  const clock = { now: () => clockNow };

  const reservations = () =>
    new InventoryReservationService(
      unitOfWork,
      { quote } as never,
      { ttlSeconds: 900 },
      ids,
      clock,
    );
  const stockService = () =>
    new InventoryStockService(
      unitOfWork,
      shops,
      {
        findVariantShops: async (variantIds) =>
          (
            await prisma.catalogVariant.findMany({
              where: { id: { in: [...variantIds] } },
              select: { id: true, product: { select: { shopId: true } } },
            })
          ).map((row) => ({ variantId: row.id, shopId: row.product.shopId })),
      },
      ids,
      clock,
    );
  const warehouseService = () =>
    new InventoryWarehouseService(unitOfWork, shops, ids, clock);

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-inventory-test-'));
    const url = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', url);
    const connection = await new PrismaBetterSqlite3({ url }).connect();
    try {
      const migrations = new URL(
        '../../../../../prisma/migrations/',
        import.meta.url,
      );
      for (const entry of (await readdir(migrations, { withFileTypes: true }))
        .filter((item) => item.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name)))
        await connection.executeScript(
          await readFile(
            new URL(`${entry.name}/migration.sql`, migrations),
            'utf8',
          ),
        );
    } finally {
      await connection.dispose();
    }
    prisma = new PrismaService();
    await prisma.$connect();
    unitOfWork = new PrismaInventoryUnitOfWork(prisma);
  });

  beforeEach(async () => {
    clockNow = new Date(start);
    quote.mockClear();
    await prisma.inventoryReservation.deleteMany();
    await prisma.inventoryMovement.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.inventoryWarehouse.deleteMany();
    await prisma.catalogVariant.deleteMany();
    await prisma.catalogProduct.deleteMany();
    await prisma.catalogCategory.deleteMany();
    await prisma.shop.deleteMany();
    await prisma.user.deleteMany();
    await prisma.user.create({
      data: {
        id: 'owner',
        emailNormalized: 'o@example.com',
        fullName: 'Owner',
        passwordHash: 'h',
        role: 'EMPLOYER',
      },
    });
    await prisma.user.create({
      data: {
        id: 'admin',
        emailNormalized: 'a@example.com',
        fullName: 'Admin',
        passwordHash: 'h',
        role: 'ADMIN',
      },
    });
    await prisma.shop.create({
      data: { id: 'shop-1', name: 'Shop', slug: 'shop', ownerId: 'owner' },
    });
    await prisma.catalogCategory.create({
      data: { id: 'cat', name: 'Cat', slug: 'cat' },
    });
    await prisma.catalogProduct.create({
      data: {
        id: 'prod-1',
        categoryId: 'cat',
        shopId: 'shop-1',
        name: 'P',
        slug: 'p',
      },
    });
    await prisma.catalogProduct.create({
      data: {
        id: 'prod-plat',
        categoryId: 'cat',
        name: 'Platform',
        slug: 'platform',
      },
    });
    for (const [id, productId] of [
      ['v1', 'prod-1'],
      ['v2', 'prod-1'],
      ['vp', 'prod-plat'],
    ])
      await prisma.catalogVariant.create({
        data: {
          id,
          productId,
          sku: id.toUpperCase(),
          name: id,
          priceAmount: 1000,
        },
      });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (directory) {
      const target = resolve(directory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !target.includes('marketplate-inventory-test-')
      )
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      await rm(target, { recursive: true, force: true });
    }
  });

  async function setup(
    stocks: Array<[code: string, priority: number, onHand: number]>,
  ) {
    const created = [];
    for (const [code, priority, onHand] of stocks) {
      const warehouse = await warehouseService().create(
        { shopId: 'shop-1' },
        { name: code, code, priority },
        seller,
      );
      if (onHand > 0)
        await stockService().receive(
          { shopId: 'shop-1' },
          {
            warehouseId: warehouse.id,
            variantId: 'v1',
            quantity: onHand,
            reason: 'seed',
          },
          seller,
        );
      created.push(warehouse);
    }
    return created;
  }
  const stockRows = () =>
    prisma.inventoryStock.findMany({ orderBy: { id: 'asc' } });

  describe('constraints', () => {
    it('rejects a duplicate warehouse code in a shop and on the platform', async () => {
      await setup([['HN', 1, 0]]);
      await expect(
        warehouseService().create(
          { shopId: 'shop-1' },
          { name: 'x', code: 'hn' },
          seller,
        ),
      ).rejects.toThrow(InventoryConflictError);
      const admin = { userId: 'admin', role: 'ADMIN' as const };
      await warehouseService().create(
        { shopId: null },
        { name: 'P', code: 'P1' },
        admin,
      );
      await expect(
        warehouseService().create(
          { shopId: null },
          { name: 'P', code: 'P1' },
          admin,
        ),
      ).rejects.toThrow(InventoryConflictError);
    });

    it('enforces reserved <= onHand in the database itself', async () => {
      const [w] = await setup([['HN', 1, 5]]);
      await expect(
        prisma.$executeRaw`UPDATE "InventoryStock" SET "reserved" = 6 WHERE "warehouseId" = ${w.id}`,
      ).rejects.toThrow();
      await expect(
        prisma.$executeRaw`UPDATE "InventoryStock" SET "onHand" = -1 WHERE "warehouseId" = ${w.id}`,
      ).rejects.toThrow();
    });

    it('turns a lost compare-and-set and a duplicate insert into retryable conflicts', async () => {
      const [w] = await setup([['HN', 1, 5]]);
      const [row] = await stockRows();
      const stock = { ...row, updatedAt: start };
      await unitOfWork.run((tx) => tx.stocks.save({ ...stock, onHand: 6 }, 1));
      await expect(
        unitOfWork.run((tx) => tx.stocks.save({ ...stock, onHand: 7 }, 1)),
      ).rejects.toThrow(InventoryVersionConflictError);
      await expect(
        unitOfWork.run((tx) =>
          tx.stocks.insert(
            createStock({
              id: randomUUID(),
              warehouseId: w.id,
              variantId: 'v1',
              now: start,
            }),
          ),
        ),
      ).rejects.toThrow(InventoryVersionConflictError);
    });

    it('reports a missing referenced warehouse or variant as not found', async () => {
      await expect(
        unitOfWork.run((tx) =>
          tx.stocks.insert(
            createStock({
              id: randomUUID(),
              warehouseId: 'nope',
              variantId: 'v1',
              now: start,
            }),
          ),
        ),
      ).rejects.toThrow(InventoryNotFoundError);
    });

    it('rolls back every write of a failed unit of work', async () => {
      await expect(
        unitOfWork.run(async (tx) => {
          await tx.warehouses.insert(
            createWarehouse({
              id: randomUUID(),
              shopId: 'shop-1',
              name: 'A',
              code: 'A',
              now: start,
            }),
          );
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await prisma.inventoryWarehouse.count()).toBe(0);
    });
  });

  describe('stock operations', () => {
    it('keeps a movement ledger and transfers atomically', async () => {
      const [a, b] = await setup([
        ['A', 1, 10],
        ['B', 2, 0],
      ]);
      await stockService().transfer(
        { shopId: 'shop-1' },
        {
          fromWarehouseId: a.id,
          toWarehouseId: b.id,
          variantId: 'v1',
          quantity: 4,
          reason: 'move',
        },
        seller,
      );
      const rows = await stockRows();
      expect(rows.map((r) => r.onHand).sort((x, y) => x - y)).toEqual([4, 6]);
      const movements = await prisma.inventoryMovement.findMany({
        where: { transferId: { not: null } },
      });
      expect(movements.map((m) => m.type).sort()).toEqual([
        'TRANSFER_IN',
        'TRANSFER_OUT',
      ]);
      expect(new Set(movements.map((m) => m.transferId)).size).toBe(1);

      await expect(
        stockService().transfer(
          { shopId: 'shop-1' },
          {
            fromWarehouseId: a.id,
            toWarehouseId: b.id,
            variantId: 'v1',
            quantity: 99,
            reason: 'x',
          },
          seller,
        ),
      ).rejects.toThrow(InsufficientStockError);
      expect(
        (await stockRows()).map((r) => r.onHand).sort((x, y) => x - y),
      ).toEqual([4, 6]);
    });

    it('scopes stock and movement listings to the addressed shop or platform', async () => {
      const [a] = await setup([['A', 1, 3]]);
      const admin = { userId: 'admin', role: 'ADMIN' as const };
      const platform = await warehouseService().create(
        { shopId: null },
        { name: 'P', code: 'P1' },
        admin,
      );
      await stockService().receive(
        { shopId: null },
        {
          warehouseId: platform.id,
          variantId: 'vp',
          quantity: 7,
          reason: 'seed',
        },
        admin,
      );
      const query = { page: 1, limit: 10 };
      const mine = await stockService().list(
        { shopId: 'shop-1' },
        query,
        seller,
      );
      expect(mine.items.map((s) => [s.warehouseId, s.onHand])).toEqual([
        [a.id, 3],
      ]);
      const platformStock = await stockService().list(
        { shopId: null },
        query,
        admin,
      );
      expect(platformStock.items.map((s) => s.onHand)).toEqual([7]);
      const history = await stockService().movements(
        { shopId: 'shop-1' },
        query,
        seller,
      );
      expect(history.items).toMatchObject([
        { type: 'RECEIPT', warehouseId: a.id, variantId: 'v1', onHandDelta: 3 },
      ]);
      expect(
        (
          await stockService().list(
            { shopId: 'shop-1' },
            { page: 1, limit: 1 },
            seller,
          )
        ).pages,
      ).toBe(1);
    });

    it('computes availability from active warehouses only', async () => {
      const [a, b] = await setup([
        ['A', 1, 2],
        ['B', 2, 5],
      ]);
      const availability = new InventoryAvailabilityService(unitOfWork);
      expect(await availability.check(['v1', 'v2'])).toEqual([
        { variantId: 'v1', inStock: true },
        { variantId: 'v2', inStock: false },
      ]);
      for (const w of [a, b])
        await warehouseService().update(
          { shopId: 'shop-1' },
          w.id,
          { version: 0, isActive: false },
          seller,
        );
      expect(await availability.check(['v1'])).toEqual([
        { variantId: 'v1', inStock: false },
      ]);
    });
  });

  describe('reservations', () => {
    const line = (quantity: number) => [{ variantId: 'v1', quantity }];

    it('runs the full lifecycle across warehouses and persists shipment per line', async () => {
      const [a, b] = await setup([
        ['A', 1, 5],
        ['B', 2, 4],
      ]);
      const service = reservations();
      const held = await service.reserve({
        idempotencyKey: 'k1',
        reference: 'order-1',
        lines: line(7),
      });
      expect(held.allocations.map((x) => [x.warehouseId, x.quantity])).toEqual([
        [a.id, 5],
        [b.id, 2],
      ]);
      // A replay is read back from storage and must keep the original allocation order.
      expect(
        await service.reserve({
          idempotencyKey: 'k1',
          reference: 'order-1',
          lines: line(7),
        }),
      ).toEqual(held);

      await service.confirm(held.reservationId);
      const partial = await service.ship(held.reservationId, a.id);
      expect(partial.status).toBe('ALLOCATED');
      expect(partial.allocations.map((x) => x.shipped)).toEqual([true, false]);
      const done = await service.ship(held.reservationId, b.id);
      expect(done.status).toBe('SHIPPED');

      const rows = Object.fromEntries(
        (await stockRows()).map((r) => [r.warehouseId, r]),
      );
      expect([
        rows[a.id].onHand,
        rows[a.id].reserved,
        rows[b.id].onHand,
        rows[b.id].reserved,
      ]).toEqual([0, 0, 2, 0]);
      const types = (
        await prisma.inventoryMovement.findMany({
          where: { reservationId: held.reservationId },
        })
      ).map((m) => m.type);
      expect(types.sort()).toEqual(['RESERVE', 'RESERVE', 'SHIP', 'SHIP']);
    });

    it('replays an idempotent request and rejects a changed one', async () => {
      await setup([['A', 1, 5]]);
      const service = reservations();
      const first = await service.reserve({
        idempotencyKey: 'k1',
        reference: 'o',
        lines: line(2),
      });
      expect(
        await service.reserve({
          idempotencyKey: 'k1',
          reference: 'o',
          lines: line(2),
        }),
      ).toEqual(first);
      expect(await prisma.inventoryReservation.count()).toBe(1);
      await expect(
        service.reserve({
          idempotencyKey: 'k1',
          reference: 'o',
          lines: line(3),
        }),
      ).rejects.toThrow('Idempotency key');
    });

    it('releases the unshipped part and expires unconfirmed holds', async () => {
      const [a, b] = await setup([
        ['A', 1, 5],
        ['B', 2, 4],
      ]);
      const service = reservations();
      const first = await service.reserve({
        idempotencyKey: 'k1',
        reference: 'o1',
        lines: line(7),
      });
      await service.confirm(first.reservationId);
      await service.ship(first.reservationId, a.id);
      await service.release(first.reservationId);
      expect(
        (
          await prisma.inventoryStock.findFirstOrThrow({
            where: { warehouseId: b.id },
          })
        ).reserved,
      ).toBe(0);

      await service.reserve({
        idempotencyKey: 'k2',
        reference: 'o2',
        lines: line(2),
      });
      expect(await service.expireDue()).toBe(0);
      clockNow = new Date(start.getTime() + 901_000);
      expect(await service.expireDue()).toBe(1);
      expect(
        (
          await prisma.inventoryStock.findFirstOrThrow({
            where: { warehouseId: b.id },
          })
        ).reserved,
      ).toBe(0);
      expect(
        (
          await prisma.inventoryReservation.findMany({
            orderBy: { createdAt: 'asc' },
          })
        ).map((r) => r.status),
      ).toEqual(['RELEASED', 'EXPIRED']);
    });

    it('never holds more than is on hand under concurrent requests', async () => {
      const [a, b] = await setup([
        ['A', 1, 3],
        ['B', 2, 2],
      ]);
      const service = reservations();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          service.reserve({
            idempotencyKey: `k${i}`,
            reference: `o${i}`,
            lines: line(1),
          }),
        ),
      );
      const accepted = outcomes.filter((o) => o.status === 'fulfilled');
      const refused = outcomes.filter((o) => o.status === 'rejected');
      expect(accepted).toHaveLength(5);
      expect(
        refused.every(
          (o) =>
            o.status === 'rejected' &&
            o.reason instanceof InsufficientStockError,
        ),
      ).toBe(true);

      const rows = Object.fromEntries(
        (await stockRows()).map((r) => [r.warehouseId, r]),
      );
      expect(rows[a.id]).toMatchObject({ onHand: 3, reserved: 3 });
      expect(rows[b.id]).toMatchObject({ onHand: 2, reserved: 2 });
      expect(await prisma.inventoryReservation.count()).toBe(5);
    });

    it('treats concurrent requests with the same key as one reservation', async () => {
      await setup([['A', 1, 5]]);
      const service = reservations();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          service.reserve({
            idempotencyKey: 'same',
            reference: 'o',
            lines: line(2),
          }),
        ),
      );
      expect(new Set(results.map((r) => r.reservationId)).size).toBe(1);
      expect((await prisma.inventoryStock.findFirstOrThrow()).reserved).toBe(2);
    });
  });
});
