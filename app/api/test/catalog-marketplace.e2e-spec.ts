import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { CatalogModule } from '../src/modules/catalog/catalog.module.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from './support/identity-app.js';

interface State {
  product: {
    id: string;
    shopId: string;
    slug: string;
    version: number;
    status: string;
    name: string;
    images: Array<{ assetId?: string; url: string }>;
    variants: Array<{
      id: string;
      priceAmount: number;
      attributes: Record<string, string>;
    }>;
  };
  revision: null | {
    id: string;
    version: number;
    status: string;
    snapshot: {
      name: string;
      variants: Array<{ id: string; priceAmount: number }>;
    };
  };
}

describe('Catalog marketplace integration', () => {
  let context: IdentityTestApp;
  let admin: string;
  let owner: string;
  let other: string;
  let ownerId: string;
  let adminId: string;
  let shopId: string;
  let categoryId: string;
  let mediaDirectory: string;

  beforeAll(async () => {
    mediaDirectory = await mkdtemp(
      join(tmpdir(), 'marketplate-catalog-media-e2e-'),
    );
    vi.stubEnv('MEDIA_STORAGE_PATH', mediaDirectory);
    context = await createIdentityTestApp([CatalogModule]);
  });
  beforeEach(async () => {
    await context.reset();
    const adminUser = await context.register('catalog-admin@example.com');
    const seller = await context.register('catalog-seller@example.com');
    await context.register('catalog-other@example.com');
    adminId = adminUser.id;
    ownerId = seller.id;
    await context.prisma.user.update({
      where: { id: adminId },
      data: { role: 'ADMIN' },
    });
    admin = (await context.login('catalog-admin@example.com')).accessToken;
    owner = (await context.login('catalog-seller@example.com')).accessToken;
    other = (await context.login('catalog-other@example.com')).accessToken;
    shopId = (
      await context
        .http()
        .post('/shops')
        .set('Authorization', `Bearer ${owner}`)
        .send({ name: 'Coffee Shop', slug: 'coffee-shop' })
        .expect(201)
    ).body.id as string;
    categoryId = (
      await context
        .http()
        .post('/admin/catalog/categories')
        .set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Coffee', slug: 'coffee' })
        .expect(201)
    ).body.id as string;
  }, 20000);
  afterAll(async () => {
    await context?.close();
    if (
      mediaDirectory &&
      resolve(mediaDirectory).startsWith(resolve(tmpdir()) + sep) &&
      mediaDirectory.includes('marketplate-catalog-media-e2e-')
    )
      await rm(mediaDirectory, { recursive: true, force: true });
  });

  const base = () => `/seller/shops/${shopId}/catalog/products`;
  async function draft(
    name = 'Cà phê Đắk Lắk',
    slug = 'ca-phe-dak-lak',
  ): Promise<State> {
    const response = await context
      .http()
      .post(base())
      .set('Authorization', `Bearer ${owner}`)
      .send({ categoryId, name, slug })
      .expect(201);
    return response.body as State;
  }
  async function withVariant() {
    const created = await draft();
    return (
      await context
        .http()
        .post(`${base()}/${created.product.id}/variants`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: 0,
          sku: 'COFFEE-250',
          name: '250g',
          priceAmount: 100000,
        })
        .expect(201)
    ).body as State;
  }
  async function published() {
    const created = await withVariant();
    const pending = (
      await context
        .http()
        .post(`${base()}/${created.product.id}/submit`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ version: created.product.version })
        .expect(200)
    ).body as State;
    await context
      .http()
      .post(`/admin/catalog/reviews/${pending.revision!.id}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: pending.revision!.version })
      .expect(200);
    return (
      await context
        .http()
        .get(`${base()}/${created.product.id}`)
        .set('Authorization', `Bearer ${owner}`)
        .expect(200)
    ).body as State;
  }

  async function upload(token = owner, targetShop = shopId) {
    const bytes = await sharp({
      create: { width: 640, height: 400, channels: 3, background: '#447755' },
    })
      .png()
      .toBuffer();
    const response = await context
      .http()
      .post('/media/assets')
      .set('Authorization', `Bearer ${token}`)
      .field('shopId', targetShop)
      .attach('file', bytes, {
        filename: 'coffee.png',
        contentType: 'image/png',
      })
      .expect(201);
    return response.body as { id: string; url: string; thumbnailUrl: string };
  }

  it('isolates shops in reads, listings and mutations, and rejects seller access to administrator routes', async () => {
    const created = await draft();
    await context
      .http()
      .get(`${base()}/${created.product.id}`)
      .set('Authorization', `Bearer ${other}`)
      .expect(403);
    await context
      .http()
      .patch(`${base()}/${created.product.id}`)
      .set('Authorization', `Bearer ${other}`)
      .send({ version: 0, name: 'Hijacked' })
      .expect(403);
    const listing = await context
      .http()
      .get(base())
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(listing.body.items.map((item: { id: string }) => item.id)).toEqual([
      created.product.id,
    ]);
    const otherShop = await context
      .http()
      .post('/shops')
      .set('Authorization', `Bearer ${other}`)
      .send({ name: 'Other', slug: 'other' })
      .expect(201);
    await context
      .http()
      .get(
        `/seller/shops/${otherShop.body.id}/catalog/products/${created.product.id}`,
      )
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
    await context
      .http()
      .post(`/admin/catalog/products/${created.product.id}/publish`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ version: 0 })
      .expect(403);
    await context
      .http()
      .post(base())
      .set('Authorization', `Bearer ${owner}`)
      .send({
        categoryId,
        shopId: otherShop.body.id,
        name: 'Spoof',
        slug: 'spoof',
      })
      .expect(400);
  });

  it('keeps EMPLOYER shop ownership, media access and publication review separate from administrator privileges', async () => {
    const previousToken = owner;
    await context
      .http()
      .patch(`/admin/users/${ownerId}/role`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'EMPLOYER' })
      .expect(200);
    await context
      .http()
      .get(base())
      .set('Authorization', `Bearer ${previousToken}`)
      .expect(401);
    owner = (await context.login('catalog-seller@example.com')).accessToken;
    await context
      .http()
      .post('/shops')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Employer Shop', slug: 'employer-shop' })
      .expect(201);
    await context
      .http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Unauthorized', slug: 'unauthorized' })
      .expect(403);

    const live = await published();
    const asset = await upload();
    const edit = await context
      .http()
      .patch(`${base()}/${live.product.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({
        version: live.product.version,
        name: 'Employer Proposed Name',
        images: [{ assetId: asset.id, url: asset.url }],
      })
      .expect(200);
    const proposed = edit.body as State;
    expect(proposed.product.name).toBe(live.product.name);
    expect(proposed.revision?.snapshot.name).toBe('Employer Proposed Name');
    const publicProduct = await context
      .http()
      .get(`/catalog/products/${live.product.slug}`)
      .expect(200);
    expect(publicProduct.body.name).toBe(live.product.name);

    const foreignShop = await context
      .http()
      .post('/shops')
      .set('Authorization', `Bearer ${other}`)
      .send({ name: 'Foreign Shop', slug: 'foreign-shop' })
      .expect(201);
    await context
      .http()
      .get(`/seller/shops/${foreignShop.body.id}/catalog/products`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(403);
  });

  it('requires approval for first publication, atomically consumes the review and records the actor', async () => {
    const created = await withVariant();
    await context
      .http()
      .get(`/catalog/products/${created.product.slug}`)
      .expect(404);
    const pending = (
      await context
        .http()
        .post(`${base()}/${created.product.id}/submit`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ version: 1 })
        .expect(200)
    ).body as State;
    expect(pending.product.status).toBe('DRAFT');
    expect(pending.revision?.status).toBe('PENDING');
    await context
      .http()
      .patch(`${base()}/${created.product.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({
        version: 1,
        revisionVersion: pending.revision!.version,
        name: 'Bypass',
      })
      .expect(409);
    await context
      .http()
      .post(`/admin/catalog/reviews/${pending.revision!.id}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: pending.revision!.version })
      .expect(200);
    await context
      .http()
      .post(`/admin/catalog/reviews/${pending.revision!.id}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: pending.revision!.version })
      .expect(409);
    const publicProduct = await context
      .http()
      .get(`/catalog/products/${created.product.slug}`)
      .expect(200);
    expect(publicProduct.body.priceFromAmount).toBe(100000);
    const audit = await context
      .http()
      .get(`/admin/catalog/products/${created.product.id}/audit`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(
      audit.body.some(
        (entry: { actorId: string; action: string }) =>
          entry.actorId === adminId && entry.action === 'APPROVE_PRODUCT',
      ),
    ).toBe(true);
    expect(
      audit.body.some(
        (entry: { actorId: string }) => entry.actorId === ownerId,
      ),
    ).toBe(true);
  });

  it('keeps the approved price live while seller revisions are edited and reviewed with independent versions', async () => {
    const live = await published();
    const variantId = live.product.variants[0].id;
    const edit = (
      await context
        .http()
        .patch(`${base()}/${live.product.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ version: live.product.version, priceAmount: 150000 })
        .expect(200)
    ).body as State;
    expect(edit.product.variants[0].priceAmount).toBe(100000);
    expect(edit.revision!.snapshot.variants[0].priceAmount).toBe(150000);
    expect(
      (
        await context
          .http()
          .get(`/catalog/products/${live.product.slug}`)
          .expect(200)
      ).body.priceFromAmount,
    ).toBe(100000);
    await context
      .http()
      .patch(`${base()}/${live.product.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ version: live.product.version, name: 'Missing revision version' })
      .expect(409);
    const pending = (
      await context
        .http()
        .post(`${base()}/${live.product.id}/submit`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          revisionVersion: edit.revision!.version,
        })
        .expect(200)
    ).body as State;
    await context
      .http()
      .post(`/admin/catalog/reviews/${pending.revision!.id}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: pending.revision!.version })
      .expect(200);
    expect(
      (
        await context
          .http()
          .get(`/catalog/products/${live.product.slug}`)
          .expect(200)
      ).body.priceFromAmount,
    ).toBe(150000);
    const audit = await context.prisma.catalogAudit.findFirstOrThrow({
      where: { entityId: live.product.id, action: 'APPROVE_PRODUCT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.before).toMatchObject({ variants: [{ priceAmount: 100000 }] });
    expect(audit.after).toMatchObject({ variants: [{ priceAmount: 150000 }] });
  });

  it('withdraws a review without discarding the proposed changes and allows versioned resubmission', async () => {
    const live = await published();
    const edit = (
      await context
        .http()
        .patch(`${base()}/${live.product.id}`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ version: live.product.version, name: 'Proposed name' })
        .expect(200)
    ).body as State;
    const pending = (
      await context
        .http()
        .post(`${base()}/${live.product.id}/submit`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          revisionVersion: edit.revision!.version,
        })
        .expect(200)
    ).body as State;
    const withdrawn = (
      await context
        .http()
        .post(`${base()}/${live.product.id}/withdraw`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          revisionVersion: pending.revision!.version,
        })
        .expect(200)
    ).body as State;
    expect(withdrawn.revision?.status).toBe('DRAFT');
    expect(withdrawn.revision?.snapshot.name).toBe('Proposed name');
    await context
      .http()
      .patch(`${base()}/${live.product.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({
        version: live.product.version,
        revisionVersion: withdrawn.revision!.version,
        name: 'Corrected name',
      })
      .expect(200);
    expect(
      (
        await context
          .http()
          .get(`/catalog/products/${live.product.slug}`)
          .expect(200)
      ).body.name,
    ).toBe(live.product.name);
  });

  it('rejects stale approvals when an administrator changes the live aggregate', async () => {
    const live = await published();
    const edit = (
      await context
        .http()
        .patch(`${base()}/${live.product.id}`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ version: live.product.version, name: 'Proposed' })
        .expect(200)
    ).body as State;
    const pending = (
      await context
        .http()
        .post(`${base()}/${live.product.id}/submit`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          revisionVersion: edit.revision!.version,
        })
        .expect(200)
    ).body as State;
    await context
      .http()
      .patch(`/admin/catalog/products/${live.product.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: live.product.version, name: 'Admin correction' })
      .expect(200);
    await context
      .http()
      .post(`/admin/catalog/reviews/${pending.revision!.id}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: pending.revision!.version })
      .expect(409);
    expect(
      (
        await context
          .http()
          .get(`/catalog/products/${live.product.slug}`)
          .expect(200)
      ).body.name,
    ).toBe('Admin correction');
  });

  it('uses server prices for batch quotes and refuses stale versions, hidden products and suspended shops', async () => {
    const live = await published();
    const variantId = live.product.variants[0].id;
    const quote = await context
      .http()
      .post('/catalog/quote')
      .send({
        lines: [
          {
            variantId,
            quantity: 2,
            expectedProductVersion: live.product.version,
            expectedUnitPriceAmount: 100000,
          },
        ],
      })
      .expect(200);
    expect(quote.body).toMatchObject({
      totalAmount: 200000,
      currency: 'VND',
      lines: [
        {
          variantId,
          shopId,
          unitPriceAmount: 100000,
          productVersion: live.product.version,
        },
      ],
    });
    await context
      .http()
      .post('/catalog/quote')
      .send({ lines: [{ variantId, quantity: 1, expectedUnitPriceAmount: 1 }] })
      .expect(409);
    await context
      .http()
      .post('/catalog/quote')
      .send({ lines: [{ variantId, quantity: 1, unitPriceAmount: 1 }] })
      .expect(400);
    await context
      .http()
      .patch(`/admin/shops/${shopId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: 0, status: 'SUSPENDED' })
      .expect(200);
    await context
      .http()
      .get(`/catalog/products/${live.product.slug}`)
      .expect(404);
    expect(
      (await context.http().get('/catalog/products').expect(200)).body.items,
    ).toEqual([]);
    await context
      .http()
      .post('/catalog/quote')
      .send({ lines: [{ variantId, quantity: 1 }] })
      .expect(404);
    await context
      .http()
      .patch(`${base()}/${live.product.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ version: live.product.version, name: 'Suspended edit' })
      .expect(409);
  });

  it('supports category trees, brands and category option schemas without permitting cycles or invalid variants', async () => {
    const child = await context
      .http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Roast',
        slug: 'roast',
        parentId: categoryId,
        attributeDefinitions: [
          { key: 'roast', values: ['Light', 'Dark'], required: true },
        ],
      })
      .expect(201);
    await context
      .http()
      .patch(`/admin/catalog/categories/${categoryId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: 0, parentId: child.body.id })
      .expect(409);
    const brand = await context
      .http()
      .post('/admin/catalog/brands')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Local Coffee', slug: 'local-coffee' })
      .expect(201);
    const created = (
      await context
        .http()
        .post(base())
        .set('Authorization', `Bearer ${owner}`)
        .send({
          categoryId: child.body.id,
          brandId: brand.body.id,
          name: 'Brand coffee',
          slug: 'brand-coffee',
        })
        .expect(201)
    ).body as State;
    await context
      .http()
      .post(`${base()}/${created.product.id}/variants`)
      .set('Authorization', `Bearer ${owner}`)
      .send({
        version: 0,
        sku: 'ROAST-LIGHT',
        name: 'Light',
        priceAmount: 100000,
      })
      .expect(400);
    await context
      .http()
      .post(`${base()}/${created.product.id}/variants`)
      .set('Authorization', `Bearer ${owner}`)
      .send({
        version: 0,
        sku: 'ROAST-LIGHT',
        name: 'Light',
        priceAmount: 100000,
        attributes: { roast: 'Light' },
      })
      .expect(201);
    const tree = await context
      .http()
      .get('/catalog/categories/tree')
      .expect(200);
    expect(tree.body[0].children[0].id).toBe(child.body.id);
    await context
      .http()
      .delete(`/admin/catalog/brands/${brand.body.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ version: 0 })
      .expect(409);
  });

  it('returns lightweight summaries, supports Vietnamese search and cursor browsing, and allows safe seller unpublish', async () => {
    const live = await published();
    const page = await context
      .http()
      .get('/catalog/products?q=CA%20PHE%20DAK%20LAK')
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0]).toMatchObject({
      id: live.product.id,
      shopId,
      priceFromAmount: 100000,
    });
    expect(page.body.items[0]).not.toHaveProperty('variants');
    expect(page.body.items[0]).not.toHaveProperty('description');
    const browse = await context
      .http()
      .get('/catalog/browse?limit=1')
      .expect(200);
    expect(browse.body.items[0].id).toBe(live.product.id);
    await context
      .http()
      .post(`${base()}/${live.product.id}/unpublish`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ version: live.product.version })
      .expect(200);
    await context
      .http()
      .get(`/catalog/products/${live.product.slug}`)
      .expect(404);
  });

  it('canonicalizes managed images and atomically prevents deletion while a product references them', async () => {
    const asset = await upload();
    const response = await context
      .http()
      .post(base())
      .set('Authorization', `Bearer ${owner}`)
      .send({
        categoryId,
        name: 'With image',
        slug: 'with-image',
        images: [
          {
            assetId: asset.id,
            url: 'https://forged.invalid/ignored.png',
            alt: 'Coffee',
          },
        ],
      })
      .expect(201);
    const state = response.body as State;
    expect(state.product.images[0]).toMatchObject({
      assetId: asset.id,
      url: asset.url,
    });
    await context
      .http()
      .delete(`/media/assets/${asset.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(409);
    await context
      .http()
      .patch(`${base()}/${state.product.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ version: 0, images: [] })
      .expect(200);
    await context
      .http()
      .delete(`/media/assets/${asset.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(204);
    await context.http().get(`/media/assets/${asset.id}/original`).expect(404);
  });

  it('pins images used only by a revision until rejection, including when the review is withdrawn', async () => {
    const live = await published();
    const asset = await upload();
    const edit = (
      await context
        .http()
        .patch(`${base()}/${live.product.id}`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          images: [{ assetId: asset.id, url: asset.url }],
        })
        .expect(200)
    ).body as State;
    await context
      .http()
      .delete(`/media/assets/${asset.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(409);
    const pending = (
      await context
        .http()
        .post(`${base()}/${live.product.id}/submit`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          revisionVersion: edit.revision!.version,
        })
        .expect(200)
    ).body as State;
    const withdrawn = (
      await context
        .http()
        .post(`${base()}/${live.product.id}/withdraw`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          revisionVersion: pending.revision!.version,
        })
        .expect(200)
    ).body as State;
    await context
      .http()
      .delete(`/media/assets/${asset.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(409);
    const resubmitted = (
      await context
        .http()
        .post(`${base()}/${live.product.id}/submit`)
        .set('Authorization', `Bearer ${owner}`)
        .send({
          version: live.product.version,
          revisionVersion: withdrawn.revision!.version,
        })
        .expect(200)
    ).body as State;
    await context
      .http()
      .post(`/admin/catalog/reviews/${resubmitted.revision!.id}/reject`)
      .set('Authorization', `Bearer ${admin}`)
      .send({
        version: resubmitted.revision!.version,
        note: 'Use a different photo',
      })
      .expect(200);
    await context
      .http()
      .delete(`/media/assets/${asset.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(204);
    expect(
      (
        await context
          .http()
          .get(`/catalog/products/${live.product.slug}`)
          .expect(200)
      ).body.images,
    ).toEqual([]);
  });

  it('rejects cross-shop image references without changing the draft or binding foreign assets', async () => {
    const otherShop = await context
      .http()
      .post('/shops')
      .set('Authorization', `Bearer ${other}`)
      .send({ name: 'Other Media Shop', slug: 'other-media' })
      .expect(201);
    const asset = await upload(other, otherShop.body.id as string);
    const created = await draft();
    await context
      .http()
      .patch(`${base()}/${created.product.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ version: 0, images: [{ assetId: asset.id, url: asset.url }] })
      .expect(403);
    expect(
      await context.prisma.mediaUsage.count({ where: { assetId: asset.id } }),
    ).toBe(0);
    expect(
      (
        await context
          .http()
          .get(`${base()}/${created.product.id}`)
          .set('Authorization', `Bearer ${owner}`)
          .expect(200)
      ).body.product.version,
    ).toBe(0);
  });
});
