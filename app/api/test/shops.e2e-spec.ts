import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ShopsModule } from '../src/modules/shops/shops.module.js';
import { SHOP_ACCESS } from '../src/modules/shops/contracts/shops.api.js';
import type { ShopAccess } from '../src/modules/shops/contracts/shops.api.js';
import {
  ShopAccessDeniedError,
  ShopUnavailableError,
} from '../src/modules/shops/domain/errors/shop.errors.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from './support/identity-app.js';

describe('Shops ownership and live availability', () => {
  let test: IdentityTestApp;
  let access: ShopAccess;
  let owner: { id: string; token: string };
  let other: { id: string; token: string };
  let admin: { id: string; token: string };

  beforeAll(async () => {
    test = await createIdentityTestApp([ShopsModule]);
    access = test.app.get<ShopAccess>(SHOP_ACCESS);
  });
  beforeEach(async () => {
    // Shops restrict hard deletion of their owners; remove them before reset.
    await test.prisma.shop.deleteMany();
    await test.reset();
    const createUser = async (email: string, administrator = false) => {
      const user = await test.register(email);
      if (administrator)
        await test.prisma.user.update({
          where: { id: user.id },
          data: { role: 'ADMIN' },
        });
      return { id: user.id, token: (await test.login(email)).accessToken };
    };
    owner = await createUser('shop-owner@example.com');
    other = await createUser('other-owner@example.com');
    admin = await createUser('shop-admin@example.com', true);
  });
  afterAll(async () => {
    await test?.close();
  });

  const create = (slug = 'my-shop') =>
    test
      .http()
      .post('/shops')
      .auth(owner.token, { type: 'bearer' })
      .send({ name: ' My Shop ', slug });

  it('creates normalized owner shops, lists them privately and exposes only safe active-shop fields', async () => {
    await test
      .http()
      .post('/shops')
      .send({ name: 'Anonymous', slug: 'anonymous' })
      .expect(401)
      .expect('Cache-Control', 'no-store');
    const created = await create(' MY-SHOP ')
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(created.body).toMatchObject({
      name: 'My Shop',
      slug: 'my-shop',
      ownerId: owner.id,
      status: 'ACTIVE',
      version: 0,
    });
    const mine = await test
      .http()
      .get('/shops/me')
      .auth(owner.token, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(mine.body.map((shop: { id: string }) => shop.id)).toEqual([
      created.body.id,
    ]);
    await test
      .http()
      .get('/shops/me')
      .auth(other.token, { type: 'bearer' })
      .expect(200, []);
    const publicShop = await test
      .http()
      .get(`/shops/${created.body.id}`)
      .expect(200);
    expect(Object.keys(publicShop.body).sort()).toEqual(
      ['id', 'name', 'slug', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('blocks another owner and privileged body fields while allowing versioned owner/admin edits', async () => {
    const { body: shop } = await create().expect(201);
    await test
      .http()
      .patch(`/shops/${shop.id}`)
      .auth(other.token, { type: 'bearer' })
      .send({ version: 0, name: 'Stolen' })
      .expect(403);
    await test
      .http()
      .post('/shops')
      .auth(owner.token, { type: 'bearer' })
      .send({ name: 'Spoofed', slug: 'spoofed', ownerId: other.id })
      .expect(400);
    const edited = await test
      .http()
      .patch(`/shops/${shop.id}`)
      .auth(owner.token, { type: 'bearer' })
      .send({ version: 0, name: 'Owner edit' })
      .expect(200);
    expect(edited.body).toMatchObject({
      name: 'Owner edit',
      version: 1,
      ownerId: owner.id,
    });
    await test
      .http()
      .patch(`/shops/${shop.id}`)
      .auth(owner.token, { type: 'bearer' })
      .send({ version: 0, name: 'Stale' })
      .expect(409);
    await test
      .http()
      .patch(`/shops/${shop.id}`)
      .auth(admin.token, { type: 'bearer' })
      .send({ version: 1, slug: 'admin-edited' })
      .expect(200);
    expect(
      (await test.prisma.shop.findUniqueOrThrow({ where: { id: shop.id } }))
        .version,
    ).toBe(2);
  });

  it('enforces normalized slug uniqueness without consuming an existing shop version', async () => {
    const { body: first } = await create('first-shop').expect(201);
    const { body: second } = await create('second-shop').expect(201);
    await create(' FIRST-SHOP ').expect(409);
    await test
      .http()
      .patch(`/shops/${second.id}`)
      .auth(owner.token, { type: 'bearer' })
      .send({ version: 0, slug: first.slug })
      .expect(409);
    expect(
      (await test.prisma.shop.findUniqueOrThrow({ where: { id: second.id } }))
        .version,
    ).toBe(0);
  });

  it('lets only administrators suspend/reactivate shops and removes suspended shops from selling/public access', async () => {
    const { body: shop } = await create().expect(201);
    await test
      .http()
      .patch(`/admin/shops/${shop.id}/status`)
      .auth(owner.token, { type: 'bearer' })
      .send({ version: 0, status: 'SUSPENDED' })
      .expect(403)
      .expect('Cache-Control', 'no-store');
    await test
      .http()
      .patch(`/admin/shops/${shop.id}/status`)
      .auth(admin.token, { type: 'bearer' })
      .send({ version: 0, status: 'SUSPENDED' })
      .expect(200);
    await test.http().get(`/shops/${shop.id}`).expect(404);
    await test
      .http()
      .patch(`/shops/${shop.id}`)
      .auth(owner.token, { type: 'bearer' })
      .send({ version: 1, name: 'Blocked' })
      .expect(409);
    await expect(
      access.requireManageable(shop.id, { userId: owner.id, role: 'USER' }),
    ).rejects.toBeInstanceOf(ShopUnavailableError);
    await expect(access.assertSellable([shop.id])).rejects.toBeInstanceOf(
      ShopUnavailableError,
    );
    await test
      .http()
      .patch(`/admin/shops/${shop.id}/status`)
      .auth(admin.token, { type: 'bearer' })
      .send({ version: 1, status: 'ACTIVE' })
      .expect(200);
    await expect(
      access.assertSellable([shop.id, shop.id]),
    ).resolves.toBeUndefined();
    await expect(access.assertSellable([])).resolves.toBeUndefined();
  });

  it('rechecks revoked accounts and current ownership through the public access port', async () => {
    const { body: shop } = await create().expect(201);
    await expect(
      access.requireManageable(shop.id, { userId: other.id, role: 'USER' }),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    await test.prisma.user.update({
      where: { id: owner.id },
      data: { status: 'LOCKED' },
    });
    await test
      .http()
      .get('/shops/me')
      .auth(owner.token, { type: 'bearer' })
      .expect(401);
    await test.http().get(`/shops/${shop.id}`).expect(404);
    await expect(
      access.requireManageable(shop.id, { userId: owner.id, role: 'USER' }),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    await expect(access.assertSellable([shop.id])).rejects.toBeInstanceOf(
      ShopUnavailableError,
    );
    await test.prisma.user.update({
      where: { id: owner.id },
      data: { status: 'ACTIVE', deletedAt: new Date() },
    });
    await expect(access.assertSellable([shop.id])).rejects.toBeInstanceOf(
      ShopUnavailableError,
    );
  });

  it('validates bounded inputs, empty updates and unsupported status changes', async () => {
    const { body: shop } = await create().expect(201);
    for (const body of [
      { version: 0 },
      { version: -1, name: 'Bad' },
      { version: 0, name: null },
      { version: 0, slug: 'invalid slug' },
    ])
      await test
        .http()
        .patch(`/shops/${shop.id}`)
        .auth(owner.token, { type: 'bearer' })
        .send(body)
        .expect(400);
    await test
      .http()
      .patch(`/admin/shops/${shop.id}/status`)
      .auth(admin.token, { type: 'bearer' })
      .send({ version: 0, status: 'DELETED' })
      .expect(400);
    await test.http().get('/shops/not-a-uuid').expect(400);
    expect(
      (await test.prisma.shop.findUniqueOrThrow({ where: { id: shop.id } }))
        .version,
    ).toBe(0);
  });
});
