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
import { InventoryHttpModule } from '../src/modules/inventory/inventory.http.module.js';
import { OrdersModule } from '../src/modules/orders/orders.module.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from './support/identity-app.js';

interface OrderBody {
  id: string;
  shopId: string | null;
  status: string;
  version: number;
}
interface StockBody {
  onHand: number;
  reserved: number;
}

describe('Orders', () => {
  let context: IdentityTestApp;
  let mediaDirectory: string;
  let admin: string;
  let seller: string;
  let buyer: string;
  let other: string;
  let shopId: string;
  let otherShopId: string;
  let shopVersion: number;
  const shopVariant = randomUUID();
  const platformVariant = randomUUID();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, token: string, body: object) =>
    context.http().post(path).set(auth(token)).send(body);
  const get = (path: string, token?: string) => {
    const request = context.http().get(path);
    return token ? request.set(auth(token)) : request;
  };
  const sellerOrders = (id = '') => `/seller/shops/${shopId}/orders${id}`;

  const checkout = (key: string, lines: object[], extra: object = {}) => ({
    idempotencyKey: key,
    lines,
    shippingAddress: {
      recipientName: 'Nguyen Van A',
      phoneNumber: '+84901234567',
      addressLine: '1 Duong Le Loi, Quan 1',
    },
    ...extra,
  });
  const both = () => [
    { variantId: shopVariant, quantity: 2 },
    { variantId: platformVariant, quantity: 1 },
  ];
  async function place(key = `key-${randomUUID()}`) {
    const res = await post('/orders', buyer, checkout(key, both())).expect(201);
    const orders = res.body.orders as OrderBody[];
    return {
      shop: orders.find((o) => o.shopId === shopId)!,
      platform: orders.find((o) => o.shopId === null)!,
    };
  }
  async function shopStock() {
    const res = await get(
      `/seller/shops/${shopId}/inventory/stocks?variantId=${shopVariant}`,
      seller,
    ).expect(200);
    return res.body.items[0] as StockBody;
  }

  async function stockUp(base: string, token: string, variantId: string) {
    const warehouse = await post(`${base}/warehouses`, token, {
      name: 'Kho',
      code: 'K1',
    }).expect(201);
    await post(`${base}/stocks/receive`, token, {
      warehouseId: warehouse.body.id,
      variantId,
      quantity: 10,
      reason: 'Nhập hàng',
    }).expect(201);
  }

  beforeAll(async () => {
    mediaDirectory = await mkdtemp(join(tmpdir(), 'marketplate-orders-e2e-'));
    vi.stubEnv('MEDIA_STORAGE_PATH', mediaDirectory);
    context = await createIdentityTestApp([OrdersModule, InventoryHttpModule]);
  });

  beforeEach(async () => {
    await context.reset();
    const adminUser = await context.register('ord-admin@example.com');
    for (const name of ['seller', 'buyer', 'other'])
      await context.register(`ord-${name}@example.com`);
    await context.prisma.user.update({
      where: { id: adminUser.id },
      data: { role: 'ADMIN' },
    });
    const token = async (name: string) =>
      (await context.login(`ord-${name}@example.com`)).accessToken;
    admin = await token('admin');
    seller = await token('seller');
    buyer = await token('buyer');
    other = await token('other');
    const createShop = async (owner: string, slug: string) =>
      (await post('/shops', owner, { name: slug, slug }).expect(201)).body as {
        id: string;
        version: number;
      };
    const shop = await createShop(seller, 'ord-shop');
    shopId = shop.id;
    shopVersion = shop.version;
    otherShopId = (await createShop(other, 'ord-other-shop')).id;

    await context.prisma.catalogCategory.create({
      data: { id: 'cat', name: 'Cat', slug: 'cat' },
    });
    for (const [id, owner, variantId] of [
      ['prod-mine', shopId, shopVariant],
      ['prod-platform', null, platformVariant],
    ] as const) {
      await context.prisma.catalogProduct.create({
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
      await context.prisma.catalogVariant.create({
        data: {
          id: variantId,
          productId: id,
          sku: variantId,
          name: id,
          priceAmount: 1000,
        },
      });
    }
    await stockUp(`/seller/shops/${shopId}/inventory`, seller, shopVariant);
    await stockUp('/admin/inventory', admin, platformVariant);
  }, 30000);

  afterAll(async () => {
    await context?.close();
    if (
      mediaDirectory &&
      resolve(mediaDirectory).startsWith(resolve(tmpdir()) + sep)
    )
      await rm(mediaDirectory, { recursive: true, force: true });
  });

  it('requires authentication', async () => {
    await get('/orders').expect(401);
    await get('/admin/orders', buyer).expect(403);
  });

  it('places, replays and splits orders', async () => {
    const body = checkout('replay-key-1', both());
    const first = await post('/orders', buyer, body).expect(201);
    expect(first.body.orders).toHaveLength(2);
    const again = await post('/orders', buyer, body).expect(200);
    expect(again.body.checkoutId).toBe(first.body.checkoutId);
    expect(await shopStock()).toMatchObject({ onHand: 10, reserved: 2 });
    const list = await get('/orders', buyer).expect(200);
    expect(list.body).toMatchObject({ total: 2, page: 1, limit: 20 });
  });

  it('validates the checkout body', async () => {
    const valid = checkout('valid-key-1', both());
    const { shippingAddress: _omitted, ...withoutAddress } = valid;
    await post('/orders', buyer, withoutAddress).expect(400);
    await post('/orders', buyer, { ...valid, extra: 1 }).expect(400);
    await post(
      '/orders',
      buyer,
      checkout('valid-key-2', [{ variantId: shopVariant, quantity: 0 }]),
    ).expect(400);
    await post('/orders', buyer, {
      ...checkout('valid-key-3', both()),
      note: null,
    }).expect(201);
  });

  it('maps catalog and stock failures', async () => {
    const wrongPrice = await post(
      '/orders',
      buyer,
      checkout('price-key-1', [
        { variantId: shopVariant, quantity: 1, expectedUnitPriceAmount: 1 },
      ]),
    ).expect(409);
    expect(wrongPrice.body.code).toBe('ORDER_PRICE_CHANGED');
    const tooMany = await post(
      '/orders',
      buyer,
      checkout('stock-key-1', [{ variantId: shopVariant, quantity: 999 }]),
    ).expect(409);
    expect(tooMany.body.code).toBe('ORDER_OUT_OF_STOCK');
  });

  it('runs the seller lifecycle and keeps other shops out', async () => {
    const { shop } = await place();
    const act = (action: string, version: number) =>
      post(sellerOrders(`/${shop.id}/${action}`), seller, { version });
    expect((await act('confirm', 0).expect(200)).body.status).toBe('CONFIRMED');
    expect((await act('ship', 1).expect(200)).body.status).toBe('SHIPPED');
    expect(await shopStock()).toMatchObject({ onHand: 8, reserved: 0 });
    expect((await act('deliver', 2).expect(200)).body.status).toBe('DELIVERED');

    const denied = await get(sellerOrders(), other).expect(403);
    expect(denied.body.code).toBe('SHOP_ACCESS_DENIED');
    const hidden = await get(
      `/seller/shops/${otherShopId}/orders/${shop.id}`,
      other,
    ).expect(404);
    expect(hidden.body.code).toBe('ORDER_NOT_FOUND');
  });

  it('lets the buyer cancel and gives the stock back', async () => {
    const { shop } = await place();
    expect(await shopStock()).toMatchObject({ reserved: 2 });
    const cancelled = await post(`/orders/${shop.id}/cancel`, buyer, {
      version: 0,
      reason: null,
    }).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await shopStock()).toMatchObject({ onHand: 10, reserved: 0 });
    await get(`/orders/${shop.id}`, other).expect(404);
  });

  it('blocks a suspended shop but not the admin', async () => {
    const { shop, platform } = await place();
    await context
      .http()
      .patch(`/admin/shops/${shopId}/status`)
      .set(auth(admin))
      .send({ version: shopVersion, status: 'SUSPENDED' })
      .expect(200);
    const blocked = await post(sellerOrders(`/${shop.id}/confirm`), seller, {
      version: 0,
    }).expect(409);
    expect(blocked.body.code).toBe('SHOP_UNAVAILABLE');
    await post(`/admin/orders/${shop.id}/cancel`, admin, {
      version: 0,
      reason: 'Shop bị khoá',
    }).expect(200);
    const list = await get('/admin/orders?shopId=platform', admin).expect(200);
    expect(list.body.items.map((o: OrderBody) => o.id)).toEqual([platform.id]);
  });

  it('rejects a stale version', async () => {
    const { shop } = await place();
    await post(sellerOrders(`/${shop.id}/confirm`), seller, {
      version: 0,
    }).expect(200);
    // The order is now at version 1; shipping with version 0 is stale.
    const stale = await post(sellerOrders(`/${shop.id}/ship`), seller, {
      version: 0,
    }).expect(409);
    expect(stale.body.code).toBe('ORDER_VERSION_CONFLICT');
  });
});
