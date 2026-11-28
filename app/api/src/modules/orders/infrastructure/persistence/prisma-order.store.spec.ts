import 'reflect-metadata';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
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
import type { OrderCheckoutRecord } from '../../application/ports/order-unit-of-work.js';
import { placeOrder, type Order } from '../../domain/entities/order.js';
import {
  OrderConflictError,
  OrderVersionConflictError,
} from '../../domain/errors/order.errors.js';
import { PrismaOrderStore } from './prisma-order.store.js';
import { PrismaOrderUnitOfWork } from './prisma-order-unit-of-work.js';

describe('Prisma order adapters', () => {
  let prisma: PrismaService;
  let store: PrismaOrderStore;
  let unitOfWork: PrismaOrderUnitOfWork;
  let directory: string;
  const t0 = new Date('2026-11-28T00:00:00.000Z');

  const line = (variantId: string, quantity = 2) => ({
    variantId,
    productId: 'prod-1',
    productName: 'P',
    variantName: variantId,
    sku: variantId.toUpperCase(),
    quantity,
    unitPriceAmount: 1000,
    lineTotalAmount: 1000 * quantity,
    productVersion: 0,
  });
  const order = (
    id: string,
    over: Partial<Order> = {},
    minutes = 0,
  ): Order => ({
    ...placeOrder({
      id,
      checkoutId: 'co-1',
      buyerId: 'buyer',
      shopId: 'shop-1',
      reservationId: `res-${id}`,
      lines: [line('v2'), line('v1', 1)],
      shippingAddress: {
        recipientName: 'An',
        phoneNumber: '0900000000',
        addressLine: '1 Main Street',
      },
      note: 'leave at door',
      now: new Date(t0.getTime() + minutes * 60_000),
    }),
    ...over,
  });
  const checkout = (id = 'co-1', key = 'key-12345'): OrderCheckoutRecord => ({
    id,
    buyerId: 'buyer',
    idempotencyKey: key,
    requestHash: 'hash',
    createdAt: t0,
  });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-orders-test-'));
    const url = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', url);
    const connection = await new PrismaBetterSqlite3({ url }).connect();
    try {
      const migrations = new URL(
        '../'.repeat(5) + 'prisma/migrations/',
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
    store = new PrismaOrderStore(prisma);
    unitOfWork = new PrismaOrderUnitOfWork(prisma);
  });

  beforeEach(async () => {
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.orderCheckout.deleteMany();
    await prisma.catalogVariant.deleteMany();
    await prisma.catalogProduct.deleteMany();
    await prisma.catalogCategory.deleteMany();
    await prisma.shop.deleteMany();
    await prisma.user.deleteMany();
    for (const [id, email] of [
      ['buyer', 'b@example.com'],
      ['owner', 'o@example.com'],
    ] as const)
      await prisma.user.create({
        data: {
          id,
          emailNormalized: email,
          fullName: id,
          passwordHash: 'h',
          role: 'EMPLOYER',
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
    for (const id of ['v1', 'v2'])
      await prisma.catalogVariant.create({
        data: {
          id,
          productId: 'prod-1',
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
        !target.includes('marketplate-orders-test-')
      )
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      await rm(target, { recursive: true, force: true });
    }
  });

  it('round-trips a checkout with its orders and lines', async () => {
    const shopOrder = order('o-1');
    const platform = order('o-2', { shopId: null, note: null });
    await store.insertCheckout(checkout(), [shopOrder, platform]);

    const found = await store.findCheckout('buyer', 'key-12345');
    expect(found?.checkout).toEqual(checkout());
    expect(found?.orders).toEqual([shopOrder, platform]);
    expect(found?.orders[0]?.lines.map((l) => l.variantId)).toEqual([
      'v2',
      'v1',
    ]);
    expect(found?.orders[1]?.shopId).toBeNull();
    expect(await store.findCheckout('buyer', 'other-key-1')).toBeNull();
    expect(await store.findById('o-1')).toEqual(shopOrder);
    expect(await store.findById('missing')).toBeNull();
  });

  it('lists by buyer, shop, platform and status, newest first', async () => {
    await store.insertCheckout(checkout(), [
      order('o-1', {}, 0),
      order('o-2', { shopId: null }, 1),
      order('o-3', {}, 2),
    ]);
    await store.save(
      { ...order('o-3', {}, 2), status: 'CONFIRMED', confirmedAt: t0 },
      0,
    );

    const ids = async (q: Parameters<PrismaOrderStore['list']>[0]) =>
      (await store.list(q)).items.map((o) => o.id);
    expect(await ids({ buyerId: 'buyer', page: 1, limit: 10 })).toEqual([
      'o-3',
      'o-2',
      'o-1',
    ]);
    expect(await ids({ shopId: 'shop-1', page: 1, limit: 10 })).toEqual([
      'o-3',
      'o-1',
    ]);
    expect(await ids({ shopId: null, page: 1, limit: 10 })).toEqual(['o-2']);
    expect(await ids({ status: 'CONFIRMED', page: 1, limit: 10 })).toEqual([
      'o-3',
    ]);
    const second = await store.list({ page: 2, limit: 2 });
    expect(second.total).toBe(3);
    expect(second.items.map((o) => o.id)).toEqual(['o-1']);
  });

  it('saves with compare-and-set', async () => {
    await store.insertCheckout(checkout(), [order('o-1')]);
    const next = {
      ...order('o-1'),
      status: 'CONFIRMED' as const,
      confirmedAt: new Date(t0.getTime() + 1000),
      updatedAt: new Date(t0.getTime() + 1000),
    };
    const saved = await store.save(next, 0);
    expect(saved.version).toBe(1);
    expect(await store.findById('o-1')).toEqual(saved);
    await expect(store.save(next, 0)).rejects.toBeInstanceOf(
      OrderVersionConflictError,
    );
  });

  it('enforces the database invariants', async () => {
    // The store has no transaction of its own, so the failed insert is wrapped.
    await expect(
      prisma.$transaction((tx) =>
        new PrismaOrderStore(tx).insertCheckout(checkout(), [
          order('o-1', { status: 'CANCELLED' }),
        ]),
      ),
    ).rejects.toThrow();
    await store.insertCheckout(checkout(), [order('o-2')]);
    await expect(
      store.insertCheckout(checkout('co-2'), [
        order('o-3', { checkoutId: 'co-2' }),
      ]),
    ).rejects.toThrow();
  });

  it('reads account and shop state inside run', async () => {
    await prisma.user.update({
      where: { id: 'buyer' },
      data: { status: 'LOCKED' },
    });
    await prisma.shop.update({
      where: { id: 'shop-1' },
      data: { status: 'SUSPENDED' },
    });
    const buyer = { userId: 'buyer', role: 'EMPLOYER' as const };
    const owner = { userId: 'owner', role: 'EMPLOYER' as const };
    await unitOfWork.run(async ({ access }) => {
      expect(await access.isActiveAccount(buyer)).toBe(false);
      expect(await access.isActiveAccount(owner)).toBe(true);
      expect(await access.findShopState('shop-1')).toEqual({
        ownerId: 'owner',
        sellable: false,
      });
      expect(await access.findShopState('nope')).toBeNull();
    });
  });

  it('translates an unhandled unique violation into a conflict', async () => {
    await store.insertCheckout(checkout(), [order('o-1')]);
    await expect(
      unitOfWork.run(({ orders }) =>
        orders.insertCheckout(checkout('co-2'), [
          order('o-1', { checkoutId: 'co-2' }),
        ]),
      ),
    ).rejects.toBeInstanceOf(OrderConflictError);
  });
});
