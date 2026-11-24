import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
import { INVENTORY_RESERVATIONS } from '../src/modules/inventory/contracts/inventory.api.js';
import type { InventoryReservations } from '../src/modules/inventory/contracts/inventory.api.js';
import { ReservationExpiryWorker } from '../src/modules/inventory/infrastructure/jobs/reservation-expiry.worker.js';
import { InventoryHttpModule } from '../src/modules/inventory/inventory.http.module.js';
import { InventoryWorkerModule } from '../src/modules/inventory/inventory.worker.module.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from './support/identity-app.js';

describe('Inventory', () => {
  let context: IdentityTestApp;
  let mediaDirectory: string;
  let admin: string;
  let seller: string;
  let stranger: string;
  let shopId: string;
  let otherShopId: string;
  let reservations: InventoryReservations;
  const v1 = randomUUID();
  const v2 = randomUUID();
  const foreign = randomUUID(); // variant of another shop
  const platformVariant = randomUUID();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const base = () => `/seller/shops/${shopId}/inventory`;
  const post = (path: string, token: string, body: object) =>
    context.http().post(path).set(auth(token)).send(body);
  const get = (path: string, token?: string) => {
    const request = context.http().get(path);
    return token ? request.set(auth(token)) : request;
  };

  async function warehouse(code: string, priority = 100) {
    const res = await post(`${base()}/warehouses`, seller, {
      name: `Kho ${code}`,
      code,
      priority,
    }).expect(201);
    return res.body as { id: string; version: number };
  }
  async function receive(
    warehouseId: string,
    variantId: string,
    quantity: number,
  ) {
    return (
      await post(`${base()}/stocks/receive`, seller, {
        warehouseId,
        variantId,
        quantity,
        reason: 'Nhập hàng',
      }).expect(201)
    ).body as {
      id: string;
      onHand: number;
      reserved: number;
      available: number;
      version: number;
    };
  }
  const availability = async (...ids: string[]) =>
    (
      await get(`/inventory/availability?variantIds=${ids.join(',')}`).expect(
        200,
      )
    ).body as Array<{
      variantId: string;
      inStock: boolean;
    }>;
  const reserve = (key: string, quantity: number, variantId = v1) =>
    reservations.reserve({
      idempotencyKey: key,
      reference: key,
      lines: [{ variantId, quantity }],
    });

  beforeAll(async () => {
    mediaDirectory = await mkdtemp(
      join(tmpdir(), 'marketplate-inventory-media-e2e-'),
    );
    vi.stubEnv('MEDIA_STORAGE_PATH', mediaDirectory);
    context = await createIdentityTestApp([
      InventoryHttpModule,
      InventoryWorkerModule,
    ]);
    reservations = context.app.get<InventoryReservations>(
      INVENTORY_RESERVATIONS,
      { strict: false },
    );
  });

  beforeEach(async () => {
    await context.reset();
    const adminUser = await context.register('inv-admin@example.com');
    await context.register('inv-seller@example.com');
    await context.register('inv-stranger@example.com');
    await context.prisma.user.update({
      where: { id: adminUser.id },
      data: { role: 'ADMIN' },
    });
    admin = (await context.login('inv-admin@example.com')).accessToken;
    seller = (await context.login('inv-seller@example.com')).accessToken;
    stranger = (await context.login('inv-stranger@example.com')).accessToken;
    const createShop = async (token: string, slug: string) =>
      (await post('/shops', token, { name: slug, slug }).expect(201)).body
        .id as string;
    shopId = await createShop(seller, 'inv-shop');
    otherShopId = await createShop(stranger, 'inv-other-shop');

    await context.prisma.catalogCategory.create({
      data: { id: 'cat', name: 'Cat', slug: 'cat' },
    });
    const product = (id: string, owner: string | null) =>
      context.prisma.catalogProduct.create({
        data: {
          id,
          categoryId: 'cat',
          shopId: owner,
          name: id,
          slug: id,
          status: 'PUBLISHED',
          minPriceAmount: 1000,
        },
      });
    await product('prod-mine', shopId);
    await product('prod-other', otherShopId);
    await product('prod-platform', null);
    for (const [id, productId] of [
      [v1, 'prod-mine'],
      [v2, 'prod-mine'],
      [foreign, 'prod-other'],
      [platformVariant, 'prod-platform'],
    ])
      await context.prisma.catalogVariant.create({
        data: { id, productId, sku: id, name: id, priceAmount: 1000 },
      });
  }, 30000);

  afterAll(async () => {
    await context?.close();
    if (
      mediaDirectory &&
      resolve(mediaDirectory).startsWith(resolve(tmpdir()) + sep)
    )
      await rm(mediaDirectory, { recursive: true, force: true });
  });

  it('requires authentication and the shop owner for seller routes', async () => {
    await get(`${base()}/warehouses`).expect(401);
    await get(`${base()}/warehouses`, stranger).expect(403);
    await get(
      `/seller/shops/${randomUUID()}/inventory/warehouses`,
      seller,
    ).expect(404);
    await get('/seller/shops/not-a-uuid/inventory/warehouses', seller).expect(
      400,
    );
    await get(`${base()}/warehouses`, admin).expect(200);
  });

  it('manages warehouses with unique codes, validation and optimistic versions', async () => {
    const hn = await warehouse('hn', 5);
    await post(`${base()}/warehouses`, seller, {
      name: 'Trùng',
      code: 'HN',
    }).expect(409);
    await post(`${base()}/warehouses`, seller, { name: '', code: '!!' }).expect(
      400,
    );
    await post(`${base()}/warehouses`, seller, {
      name: 'x',
      code: 'OK',
      priority: 5000,
    }).expect(400);
    await post(`${base()}/warehouses`, seller, {
      name: 'x',
      code: 'OK',
      extra: 1,
    }).expect(400);

    const updated = await context
      .http()
      .patch(`${base()}/warehouses/${hn.id}`)
      .set(auth(seller))
      .send({ version: 0, isActive: false })
      .expect(200);
    expect(updated.body).toMatchObject({
      isActive: false,
      version: 1,
      code: 'HN',
    });
    const stale = await context
      .http()
      .patch(`${base()}/warehouses/${hn.id}`)
      .set(auth(seller))
      .send({ version: 0, name: 'Muộn' })
      .expect(409);
    expect(stale.body.code).toBe('INVENTORY_STALE_VERSION');
    expect(
      (await get(`${base()}/warehouses`, seller).expect(200)).body,
    ).toHaveLength(1);
    // Another shop's owner cannot see or touch it, even by guessing the id.
    await context
      .http()
      .patch(`/seller/shops/${otherShopId}/inventory/warehouses/${hn.id}`)
      .set(auth(stranger))
      .send({ version: 0, name: 'x' })
      .expect(404);
  });

  it('receives, adjusts and transfers stock while keeping a movement ledger', async () => {
    const a = await warehouse('a', 1);
    const b = await warehouse('b', 2);
    const stock = await receive(a.id, v1, 10);
    expect(stock).toMatchObject({ onHand: 10, available: 10, version: 1 });

    const adjusted = await post(`${base()}/stocks/adjust`, seller, {
      warehouseId: a.id,
      variantId: v1,
      quantityDelta: -2,
      reason: 'Kiểm kê',
      version: stock.version,
    }).expect(201);
    expect(adjusted.body).toMatchObject({ onHand: 8, version: 2 });
    const stale = await post(`${base()}/stocks/adjust`, seller, {
      warehouseId: a.id,
      variantId: v1,
      quantityDelta: -1,
      reason: 'x',
      version: stock.version,
    }).expect(409);
    expect(stale.body.code).toBe('INVENTORY_STALE_VERSION');

    const moved = await post(`${base()}/stocks/transfer`, seller, {
      fromWarehouseId: a.id,
      toWarehouseId: b.id,
      variantId: v1,
      quantity: 3,
      reason: 'Cân bằng kho',
    }).expect(201);
    expect(moved.body).toMatchObject({
      from: { onHand: 5 },
      to: { onHand: 3 },
    });
    await post(`${base()}/stocks/transfer`, seller, {
      fromWarehouseId: a.id,
      toWarehouseId: a.id,
      variantId: v1,
      quantity: 1,
      reason: 'x',
    }).expect(400);
    await post(`${base()}/stocks/transfer`, seller, {
      fromWarehouseId: a.id,
      toWarehouseId: b.id,
      variantId: v1,
      quantity: 99,
      reason: 'x',
    }).expect(409);

    const list = (
      await get(`${base()}/stocks?variantId=${v1}`, seller).expect(200)
    ).body;
    expect(list).toMatchObject({ total: 2, page: 1, pages: 1 });
    const types = (
      await get(`${base()}/movements`, seller).expect(200)
    ).body.items.map((m: { type: string }) => m.type);
    expect(types.sort()).toEqual([
      'ADJUSTMENT',
      'RECEIPT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
    ]);
    await get(`${base()}/stocks?limit=500`, seller).expect(400);
  });

  it('only stocks variants that belong to the shop and keeps shops isolated', async () => {
    const a = await warehouse('a');
    await post(`${base()}/stocks/receive`, seller, {
      warehouseId: a.id,
      variantId: foreign,
      quantity: 1,
      reason: 'x',
    }).expect(404);
    await post(`${base()}/stocks/receive`, seller, {
      warehouseId: a.id,
      variantId: platformVariant,
      quantity: 1,
      reason: 'x',
    }).expect(404);
    await post(`${base()}/stocks/receive`, seller, {
      warehouseId: a.id,
      variantId: v1,
      quantity: 0,
      reason: 'x',
    }).expect(400);
    await receive(a.id, v1, 4);
    const theirs = await get(
      `/seller/shops/${otherShopId}/inventory/stocks`,
      stranger,
    ).expect(200);
    expect(theirs.body.items).toEqual([]);
  });

  it('keeps platform inventory administrator-only and separate from shops', async () => {
    await get('/admin/inventory/warehouses', seller).expect(403);
    await get('/admin/inventory/warehouses').expect(401);
    const created = await post('/admin/inventory/warehouses', admin, {
      name: 'Kho tổng',
      code: 'MAIN',
    }).expect(201);
    expect(created.body.shopId).toBeNull();
    await post('/admin/inventory/stocks/receive', admin, {
      warehouseId: created.body.id,
      variantId: platformVariant,
      quantity: 6,
      reason: 'Nhập',
    }).expect(201);
    await post('/admin/inventory/stocks/receive', admin, {
      warehouseId: created.body.id,
      variantId: v1,
      quantity: 1,
      reason: 'x',
    }).expect(404);
    expect(
      (await get('/admin/inventory/stocks', admin).expect(200)).body.items,
    ).toHaveLength(1);
    // A shop owner cannot reach platform warehouses through the shop routes.
    expect(
      (await get(`${base()}/stocks`, seller).expect(200)).body.items,
    ).toEqual([]);
    await context
      .http()
      .patch(`${base()}/warehouses/${created.body.id}`)
      .set(auth(seller))
      .send({ version: 0, name: 'x' })
      .expect(404);
  });

  it('reports availability publicly without quantities and ignores inactive warehouses', async () => {
    const a = await warehouse('a');
    const b = await warehouse('b');
    await receive(a.id, v1, 2);
    await receive(b.id, v2, 5);
    expect(await availability(v1, v2, foreign)).toEqual([
      { variantId: v1, inStock: true },
      { variantId: v2, inStock: true },
      { variantId: foreign, inStock: false },
    ]);
    await context
      .http()
      .patch(`${base()}/warehouses/${b.id}`)
      .set(auth(seller))
      .send({ version: 0, isActive: false })
      .expect(200);
    expect((await availability(v2))[0].inStock).toBe(false);
    await get('/inventory/availability').expect(400);
    await get('/inventory/availability?variantIds=nope').expect(400);
    await get(
      `/inventory/availability?variantIds=${Array.from({ length: 101 }, () => randomUUID()).join(',')}`,
    ).expect(400);
  });

  describe('reservations (contract used by Orders)', () => {
    it('splits across warehouses, confirms, ships per warehouse and updates availability', async () => {
      const a = await warehouse('a', 1);
      const b = await warehouse('b', 2);
      await receive(a.id, v1, 3);
      await receive(b.id, v1, 2);

      const held = await reserve('order-1', 4);
      expect(held.allocations.map((x) => [x.warehouseId, x.quantity])).toEqual([
        [a.id, 3],
        [b.id, 1],
      ]);
      expect((await availability(v1))[0].inStock).toBe(true);
      expect((await reserve('order-2', 2).catch((e) => e)).code).toBe(
        'INSUFFICIENT_STOCK',
      );

      await reservations.confirm(held.reservationId);
      expect((await reservations.ship(held.reservationId, a.id)).status).toBe(
        'ALLOCATED',
      );
      expect((await reservations.ship(held.reservationId, b.id)).status).toBe(
        'SHIPPED',
      );
      const stocks = (await get(`${base()}/stocks`, seller).expect(200)).body
        .items as Array<{
        warehouseId: string;
        onHand: number;
        reserved: number;
      }>;
      expect(
        Object.fromEntries(
          stocks.map((s) => [s.warehouseId, [s.onHand, s.reserved]]),
        ),
      ).toEqual({
        [a.id]: [0, 0],
        [b.id]: [1, 0],
      });
      const types = (
        await get(`${base()}/movements?warehouseId=${a.id}`, seller).expect(200)
      ).body.items.map((m: { type: string }) => m.type);
      expect(types).toEqual(
        expect.arrayContaining(['RECEIPT', 'RESERVE', 'SHIP']),
      );
    });

    it('turns the product out of stock while held and back when released', async () => {
      const a = await warehouse('a');
      await receive(a.id, v1, 2);
      const held = await reserve('order-1', 2);
      expect((await availability(v1))[0].inStock).toBe(false);
      await reservations.release(held.reservationId);
      expect((await availability(v1))[0].inStock).toBe(true);
    });

    it('answers a repeated idempotency key with the same reservation', async () => {
      const a = await warehouse('a');
      await receive(a.id, v1, 5);
      const first = await reserve('same', 2);
      expect(await reserve('same', 2)).toEqual(first);
      expect(
        (await get(`${base()}/stocks`, seller).expect(200)).body.items[0]
          .reserved,
      ).toBe(2);
      await expect(reserve('same', 3)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
    });

    it('never holds more than is on hand under concurrent requests', async () => {
      const a = await warehouse('a', 1);
      const b = await warehouse('b', 2);
      await receive(a.id, v1, 3);
      await receive(b.id, v1, 2);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) => reserve(`race-${i}`, 1)),
      );
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(5);
      const stocks = (await get(`${base()}/stocks`, seller).expect(200)).body
        .items as Array<{
        onHand: number;
        reserved: number;
      }>;
      expect(stocks.reduce((sum, s) => sum + s.reserved, 0)).toBe(5);
      expect(stocks.every((s) => s.reserved <= s.onHand)).toBe(true);
      expect((await availability(v1))[0].inStock).toBe(false);
    });

    it('expires unconfirmed holds through the worker and frees the stock', async () => {
      const a = await warehouse('a');
      await receive(a.id, v1, 2);
      const stale = await reserve('stale', 1);
      const kept = await reserve('kept', 1);
      await reservations.confirm(kept.reservationId);
      expect((await availability(v1))[0].inStock).toBe(false);
      // Push the stale hold past its TTL; confirming `kept` already removed its expiry.
      await context.prisma.inventoryReservation.update({
        where: { id: stale.reservationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await context.app.get(ReservationExpiryWorker, { strict: false }).sweep();

      const status = async (id: string) =>
        (
          await context.prisma.inventoryReservation.findUniqueOrThrow({
            where: { id },
          })
        ).status;
      expect(await status(stale.reservationId)).toBe('EXPIRED');
      expect(await status(kept.reservationId)).toBe('ALLOCATED');
      expect((await availability(v1))[0].inStock).toBe(true);
      expect(
        (await context.prisma.inventoryStock.findFirstOrThrow()).reserved,
      ).toBe(1);
      await expect(
        reservations.confirm(stale.reservationId),
      ).rejects.toMatchObject({
        code: 'INVALID_RESERVATION_STATE',
      });
    });

    it('refuses to hold variants that can no longer be purchased', async () => {
      const a = await warehouse('a');
      await receive(a.id, v1, 5);
      const stockHeld = async () =>
        (
          await context.prisma.inventoryStock.findFirstOrThrow({
            where: { variantId: v1 },
          })
        ).reserved;

      await context.prisma.catalogVariant.update({
        where: { id: v1 },
        data: { isActive: false },
      });
      await expect(reserve('o1', 1)).rejects.toThrow(/not available/);
      await context.prisma.catalogVariant.update({
        where: { id: v1 },
        data: { isActive: true },
      });
      await context.prisma.catalogProduct.update({
        where: { id: 'prod-mine' },
        data: { status: 'DRAFT' },
      });
      await expect(reserve('o2', 1)).rejects.toThrow(/not available/);
      await context.prisma.catalogProduct.update({
        where: { id: 'prod-mine' },
        data: { status: 'PUBLISHED' },
      });
      await context.prisma.shop.update({
        where: { id: shopId },
        data: { status: 'SUSPENDED' },
      });
      await expect(reserve('o3', 1)).rejects.toThrow(/not available/);
      expect(await stockHeld()).toBe(0);

      // The existing shop rules also stop a suspended shop from changing its own stock.
      const res = await post(`${base()}/stocks/receive`, seller, {
        warehouseId: a.id,
        variantId: v1,
        quantity: 1,
        reason: 'x',
      }).expect(409);
      expect(res.body.code).toBe('SHOP_UNAVAILABLE');

      await context.prisma.shop.update({
        where: { id: shopId },
        data: { status: 'ACTIVE' },
      });
      expect((await reserve('o4', 1)).status).toBe('ACTIVE');
    });
  });
});
