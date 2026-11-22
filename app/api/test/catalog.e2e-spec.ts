import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CatalogModule } from '../src/modules/catalog/catalog.module.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from './support/identity-app.js';

interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  version: number;
}

interface VariantResponse {
  id: string;
  sku: string;
  name: string;
  priceAmount: number;
  currency: string;
  isActive: boolean;
  attributes: Record<string, string>;
}

interface ProductResponse {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  images: Array<{ url: string; alt?: string }>;
  status: string;
  version: number;
  variants: VariantResponse[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

describe('Catalog public reads and administrator mutations', () => {
  let test: IdentityTestApp;
  let adminToken: string;

  beforeAll(async () => {
    test = await createIdentityTestApp([CatalogModule]);
  });
  beforeEach(async () => {
    await test.reset();
    const admin = await test.register(
      'catalog-admin@example.com',
      'Catalog Admin',
    );
    await test.prisma.user.update({
      where: { id: admin.id },
      data: { role: 'ADMIN' },
    });
    adminToken = (await test.login(admin.email)).accessToken;
  });
  afterAll(async () => {
    await test?.close();
  });

  async function createCategory(slug = 'clothing'): Promise<CategoryResponse> {
    const response = await test
      .http()
      .post('/admin/catalog/categories')
      .auth(adminToken, { type: 'bearer' })
      .send({ name: 'Clothing', slug })
      .expect(201);
    return response.body as CategoryResponse;
  }

  async function createProduct(
    categoryId: string,
    slug = 'cotton-shirt',
    overrides: {
      name?: string;
      images?: Array<{ url: string; alt?: string }>;
    } = {},
  ): Promise<ProductResponse> {
    const response = await test
      .http()
      .post('/admin/catalog/products')
      .auth(adminToken, { type: 'bearer' })
      .send({
        categoryId,
        name: 'Cotton Shirt',
        slug,
        description: 'Soft cotton',
        ...overrides,
      })
      .expect(201);
    return response.body as ProductResponse;
  }

  async function addVariant(
    product: ProductResponse,
    sku = 'SHIRT-BLUE-M',
    isActive = true,
    priceAmount = 199000,
    attributes?: Record<string, string>,
  ): Promise<ProductResponse> {
    const response = await test
      .http()
      .post(`/admin/catalog/products/${product.id}/variants`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        version: product.version,
        sku,
        name: 'Blue / M',
        priceAmount,
        isActive,
        attributes,
      })
      .expect(201);
    return response.body as ProductResponse;
  }

  async function publish(product: ProductResponse): Promise<ProductResponse> {
    const response = await test
      .http()
      .post(`/admin/catalog/products/${product.id}/publish`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: product.version })
      .expect(200);
    return response.body as ProductResponse;
  }

  it('denies anonymous and ordinary-user writes while allowing public reads', async () => {
    await test.http().get('/catalog/categories').expect(200, []);
    await test
      .http()
      .post('/admin/catalog/categories')
      .send({ name: 'Clothing', slug: 'clothing' })
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await test
      .http()
      .get('/admin/catalog/products')
      .expect(401)
      .expect('Cache-Control', 'no-store');

    const user = await test.register('catalog-user@example.com');
    const { accessToken } = await test.login(user.email);
    await test
      .http()
      .post('/admin/catalog/categories')
      .auth(accessToken, { type: 'bearer' })
      .send({ name: 'Clothing', slug: 'clothing' })
      .expect(403)
      .expect('Cache-Control', 'no-store');
    expect(await test.prisma.catalogCategory.count()).toBe(0);
  });

  it('hides draft products from public detail and lists but exposes them to administrators', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    expect(product).toMatchObject({
      status: 'DRAFT',
      version: 0,
      variants: [],
      publishedAt: null,
    });
    await test.http().get(`/catalog/products/${product.slug}`).expect(404);
    const publicList = await test.http().get('/catalog/products').expect(200);
    expect(publicList.body).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      pages: 0,
    });
    const adminList = await test
      .http()
      .get('/admin/catalog/products')
      .query({
        status: 'DRAFT',
        categoryId: category.id,
        q: 'Cotton',
        page: 1,
        limit: 1,
      })
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(adminList.body).toMatchObject({
      total: 1,
      page: 1,
      limit: 1,
      pages: 1,
    });
    expect(adminList.body.items[0].id).toBe(product.id);
    await test
      .http()
      .get(`/admin/catalog/products/${product.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
  });

  it('runs the draft, variant, publish, versioned edit and archive lifecycle', async () => {
    const category = await createCategory();
    const draft = await createProduct(category.id);
    const withVariant = await addVariant(draft);
    expect(withVariant.version).toBe(draft.version + 1);
    const published = await publish(withVariant);
    expect(published).toMatchObject({
      status: 'PUBLISHED',
      version: withVariant.version + 1,
    });
    expect(published.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const publicProduct = await test
      .http()
      .get(`/catalog/products/${published.slug}`)
      .expect(200);
    expect(publicProduct.body).not.toHaveProperty('status');
    expect(publicProduct.body).not.toHaveProperty('version');
    expect(publicProduct.body.variants).toHaveLength(1);
    expect(publicProduct.body.variants[0]).toMatchObject({
      sku: 'SHIRT-BLUE-M',
      priceAmount: 199000,
      currency: 'VND',
    });
    expect(publicProduct.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const list = await test
      .http()
      .get('/catalog/products')
      .query({ categoryId: category.id, q: 'Cotton' })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).not.toHaveProperty('version');
    expect(list.body.items[0]).not.toHaveProperty('status');

    const edited = await test
      .http()
      .patch(`/admin/catalog/products/${published.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: published.version, name: 'Updated Cotton Shirt' })
      .expect(200);
    expect(edited.body.version).toBe(published.version + 1);
    await test
      .http()
      .patch(`/admin/catalog/products/${published.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: published.version, name: 'Stale overwrite' })
      .expect(409);
    const unchanged = await test
      .http()
      .get(`/catalog/products/${published.slug}`)
      .expect(200);
    expect(unchanged.body.name).toBe('Updated Cotton Shirt');

    await test
      .http()
      .post(`/admin/catalog/products/${published.id}/archive`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: edited.body.version })
      .expect(200);
    await test.http().get(`/catalog/products/${published.slug}`).expect(404);
    const hidden = await test.http().get('/catalog/products').expect(200);
    expect(hidden.body).toMatchObject({ items: [], total: 0 });
  });

  it('rejects publishing without an active variant and hides inactive variants', async () => {
    const category = await createCategory();
    const draft = await createProduct(category.id);
    await test
      .http()
      .post(`/admin/catalog/products/${draft.id}/publish`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: draft.version })
      .expect(409);
    const active = await addVariant(draft);
    const mixed = await addVariant(active, 'SHIRT-RED-L', false);
    const published = await publish(mixed);
    const publicProduct = await test
      .http()
      .get(`/catalog/products/${published.slug}`)
      .expect(200);
    expect(publicProduct.body.variants).toHaveLength(1);
    expect(publicProduct.body.variants[0].sku).toBe('SHIRT-BLUE-M');
    const visibleList = await test.http().get('/catalog/products').expect(200);
    expect(visibleList.body.items[0]).not.toHaveProperty('variants');
    expect(visibleList.body.items[0]).not.toHaveProperty('description');
    expect(visibleList.body.items[0].priceFromAmount).toBe(199000);
    const activeVariant = published.variants.find(
      (variant) => variant.isActive,
    )!;
    await test
      .http()
      .patch(
        `/admin/catalog/products/${published.id}/variants/${activeVariant.id}`,
      )
      .auth(adminToken, { type: 'bearer' })
      .send({ version: published.version, isActive: false })
      .expect(409);
    const retained = await test
      .http()
      .get(`/catalog/products/${published.slug}`)
      .expect(200);
    expect(retained.body.variants).toHaveLength(1);
  });

  it('returns conflicts for duplicate slugs and globally duplicated normalized SKUs', async () => {
    const category = await createCategory();
    await test
      .http()
      .post('/admin/catalog/categories')
      .auth(adminToken, { type: 'bearer' })
      .send({ name: 'Duplicate', slug: category.slug })
      .expect(409);
    const first = await createProduct(category.id);
    await addVariant(first);
    const second = await createProduct(category.id, 'another-shirt');
    await test
      .http()
      .post(`/admin/catalog/products/${second.id}/variants`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        version: second.version,
        sku: ' shirt-blue-m ',
        name: 'Duplicate SKU',
        priceAmount: 1000,
      })
      .expect(409);
    const unchanged = await test
      .http()
      .get(`/admin/catalog/products/${second.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(unchanged.body).toMatchObject({ version: 0, variants: [] });
  });

  it('validates fields, IDs, query bounds, currency and versioned mutations', async () => {
    const category = await createCategory();
    const draft = await createProduct(category.id);
    const productPath = `/admin/catalog/products/${draft.id}`;
    for (const body of [
      { name: 'Missing version' },
      { version: 0 },
      { version: -1, name: 'Bad version' },
      { version: 0, name: null },
      { version: 0, name: 'x'.repeat(161) },
      { version: 0, slug: 'Uppercase Invalid Slug' },
    ]) {
      await test
        .http()
        .patch(productPath)
        .auth(adminToken, { type: 'bearer' })
        .send(body)
        .expect(400);
    }
    for (const body of [
      { version: 0, sku: 'SHIRT', name: 'Blue', priceAmount: -1 },
      { version: 0, sku: 'SHIRT', name: 'Blue', priceAmount: 1.5 },
      {
        version: 0,
        sku: 'SHIRT',
        name: 'Blue',
        priceAmount: 1000,
        currency: 'USD',
      },
      {
        version: 0,
        sku: 'SHIRT',
        name: 'Blue',
        priceAmount: 1000,
        isActive: 'false',
      },
    ]) {
      await test
        .http()
        .post(`${productPath}/variants`)
        .auth(adminToken, { type: 'bearer' })
        .send(body)
        .expect(400);
    }
    await test
      .http()
      .get('/admin/catalog/products/invalid-id')
      .auth(adminToken, { type: 'bearer' })
      .expect(400);
    await test
      .http()
      .get(`/admin/catalog/products/${randomUUID()}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
    for (const query of [
      { page: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { q: 'x'.repeat(101) },
      { status: 'DRAFT' },
    ]) {
      await test.http().get('/catalog/products').query(query).expect(400);
    }
    expect(await test.prisma.catalogVariant.count()).toBe(0);
  });

  it('rejects SKU changes and empty variant patches without altering the aggregate', async () => {
    const category = await createCategory();
    const product = await addVariant(await createProduct(category.id));
    const variant = product.variants[0];
    const path = `/admin/catalog/products/${product.id}/variants/${variant.id}`;
    await test
      .http()
      .patch(path)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: product.version, sku: 'NEW-SKU' })
      .expect(400);
    await test
      .http()
      .patch(path)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: product.version })
      .expect(400);
    const updated = await test
      .http()
      .patch(path)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: product.version, priceAmount: 249000 })
      .expect(200);
    expect(updated.body.variants[0].priceAmount).toBe(249000);
    expect(updated.body.version).toBe(product.version + 1);
  });

  it('edits categories with optimistic versions and deletes only unused categories', async () => {
    const category = await createCategory();
    expect(category.version).toBe(0);
    const categories = await test.http().get('/catalog/categories').expect(200);
    expect(categories.body[0]).not.toHaveProperty('version');
    const adminCategories = await test
      .http()
      .get('/admin/catalog/categories')
      .auth(adminToken, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(adminCategories.body[0]).toMatchObject({
      id: category.id,
      version: 0,
    });
    await test
      .http()
      .get(`/admin/catalog/categories/${category.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);

    const updated = await test
      .http()
      .patch(`/admin/catalog/categories/${category.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        version: 0,
        name: ' Updated Clothing ',
        slug: ' Updated-Clothing ',
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      id: category.id,
      name: 'Updated Clothing',
      slug: 'updated-clothing',
      version: 1,
    });
    await test
      .http()
      .patch(`/admin/catalog/categories/${category.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: 0, name: 'Stale name' })
      .expect(409);
    await test
      .http()
      .patch(`/admin/catalog/categories/${category.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: 1 })
      .expect(400);
    await test
      .http()
      .delete(`/admin/catalog/categories/${category.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: 0 })
      .expect(409);
    await test
      .http()
      .delete(`/admin/catalog/categories/${category.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: 1 })
      .expect(204);
    await test
      .http()
      .get(`/admin/catalog/categories/${category.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
    await test.http().get('/catalog/categories').expect(200, []);

    const used = await createCategory('used-category');
    const draft = await createProduct(used.id);
    await test
      .http()
      .delete(`/admin/catalog/categories/${used.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: used.version })
      .expect(409);
    await test
      .http()
      .post(`/admin/catalog/products/${draft.id}/archive`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: draft.version })
      .expect(200);
    await test
      .http()
      .delete(`/admin/catalog/categories/${used.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: used.version })
      .expect(409);
  });

  it('persists ordered images and editable variant attributes without changing stable identifiers', async () => {
    const category = await createCategory();
    const images = [
      { url: 'https://images.example.com/front.jpg', alt: 'Front view' },
      { url: 'https://images.example.com/back.jpg', alt: 'Back view' },
    ];
    const draft = await createProduct(category.id, 'image-shirt', { images });
    expect(draft.images).toEqual(images);
    const withVariant = await addVariant(draft, 'IMAGE-BLUE-M', true, 199000, {
      color: 'blue',
      size: 'm',
    });
    const variant = withVariant.variants[0];
    expect(variant.attributes).toEqual({ color: 'blue', size: 'm' });
    const published = await publish(withVariant);
    const visible = await test
      .http()
      .get(`/catalog/products/${published.slug}`)
      .expect(200);
    expect(visible.body.images).toEqual(images);
    expect(visible.body.variants[0]).toMatchObject({
      id: variant.id,
      sku: variant.sku,
      attributes: { color: 'blue', size: 'm' },
    });

    const reordered = await test
      .http()
      .patch(`/admin/catalog/products/${published.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: published.version, images: [...images].reverse() })
      .expect(200);
    expect(reordered.body.images).toEqual([...images].reverse());
    const edited = await test
      .http()
      .patch(`/admin/catalog/products/${published.id}/variants/${variant.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        version: reordered.body.version,
        attributes: { color: 'green', size: 'm' },
      })
      .expect(200);
    expect(edited.body.variants[0]).toMatchObject({
      id: variant.id,
      sku: variant.sku,
      attributes: { color: 'green', size: 'm' },
    });
    const cleared = await test
      .http()
      .patch(`/admin/catalog/products/${published.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: edited.body.version, images: [] })
      .expect(200);
    expect(cleared.body.images).toEqual([]);
    const publicEdited = await test
      .http()
      .get(`/catalog/products/${published.slug}`)
      .expect(200);
    expect(publicEdited.body.images).toEqual([]);
    expect(publicEdited.body.variants[0].attributes.color).toBe('green');
  });

  it('rejects malformed media and attributes without consuming the product version', async () => {
    const category = await createCategory();
    const draft = await createProduct(category.id);
    const path = `/admin/catalog/products/${draft.id}`;
    for (const images of [
      null,
      {},
      [null],
      [{ url: 'javascript:alert(1)' }],
      [{ url: 'https://user:password@images.example.com/image.jpg' }],
      [{ url: 'https://images.example.com/image.jpg', alt: 'x'.repeat(201) }],
      [{ url: 'https://images.example.com/image.jpg', alt: null }],
      [{ url: 'https://images.example.com/image.jpg', unexpected: true }],
      Array.from({ length: 11 }, (_, index) => ({
        url: `https://images.example.com/${index}.jpg`,
      })),
    ]) {
      await test
        .http()
        .patch(path)
        .auth(adminToken, { type: 'bearer' })
        .send({ version: draft.version, images })
        .expect(400);
    }
    for (const attributes of [
      null,
      [],
      { '': 'blue' },
      { ['x'.repeat(41)]: 'blue' },
      { color: 'x'.repeat(81) },
      { color: 12 },
      { color: { nested: 'blue' } },
      Object.fromEntries(
        Array.from({ length: 11 }, (_, index) => [`key${index}`, 'value']),
      ),
    ]) {
      await test
        .http()
        .post(`${path}/variants`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          version: draft.version,
          sku: 'INVALID-ATTRIBUTES',
          name: 'Invalid',
          priceAmount: 1000,
          attributes,
        })
        .expect(400);
    }
    const unchanged = await test
      .http()
      .get(path)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(unchanged.body).toMatchObject({
      version: draft.version,
      images: [],
      variants: [],
    });
  });

  it('rejects duplicate normalized attribute combinations on both add and update', async () => {
    const category = await createCategory();
    const first = await addVariant(
      await createProduct(category.id),
      'ATTR-BLUE-M',
      true,
      1000,
      { color: 'Blue', size: 'M' },
    );
    await test
      .http()
      .post(`/admin/catalog/products/${first.id}/variants`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        version: first.version,
        sku: 'ATTR-DUPLICATE',
        name: 'Duplicate',
        priceAmount: 2000,
        attributes: { size: 'm', COLOR: ' blue ' },
      })
      .expect(409);
    const second = await addVariant(first, 'ATTR-RED-M', true, 2000, {
      color: 'Red',
      size: 'M',
    });
    const red = second.variants.find(
      (variant) => variant.sku === 'ATTR-RED-M',
    )!;
    await test
      .http()
      .patch(`/admin/catalog/products/${second.id}/variants/${red.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        version: second.version,
        attributes: { color: 'BLUE', size: 'm' },
      })
      .expect(409);
    const retained = await test
      .http()
      .get(`/admin/catalog/products/${second.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(retained.body.version).toBe(second.version);
    expect(
      retained.body.variants.find(
        (variant: VariantResponse) => variant.id === red.id,
      ).attributes.color,
    ).toBe('Red');
  });

  it('unpublishes and restores products to editable drafts before publishing again', async () => {
    const category = await createCategory();
    const published = await publish(
      await addVariant(await createProduct(category.id)),
    );
    const variant = published.variants[0];
    const unpublished = await test
      .http()
      .post(`/admin/catalog/products/${published.id}/unpublish`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: published.version })
      .expect(200);
    expect(unpublished.body).toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
      version: published.version + 1,
    });
    await test.http().get(`/catalog/products/${published.slug}`).expect(404);
    const disabled = await test
      .http()
      .patch(`/admin/catalog/products/${published.id}/variants/${variant.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: unpublished.body.version, isActive: false })
      .expect(200);
    await test
      .http()
      .post(`/admin/catalog/products/${published.id}/publish`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: disabled.body.version })
      .expect(409);
    const enabled = await test
      .http()
      .patch(`/admin/catalog/products/${published.id}/variants/${variant.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: disabled.body.version, isActive: true })
      .expect(200);
    const republished = await publish(enabled.body as ProductResponse);
    const archived = await test
      .http()
      .post(`/admin/catalog/products/${published.id}/archive`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: republished.version })
      .expect(200);
    const restored = await test
      .http()
      .post(`/admin/catalog/products/${published.id}/restore`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: archived.body.version })
      .expect(200);
    expect(restored.body).toMatchObject({
      id: published.id,
      status: 'DRAFT',
      publishedAt: null,
    });
    expect(restored.body.variants[0]).toMatchObject({
      id: variant.id,
      sku: variant.sku,
    });
    await test.http().get(`/catalog/products/${published.slug}`).expect(404);
    await test
      .http()
      .post(`/admin/catalog/products/${published.id}/restore`)
      .auth(adminToken, { type: 'bearer' })
      .send({ version: restored.body.version })
      .expect(409);
    const visibleAgain = await publish(restored.body as ProductResponse);
    await test.http().get(`/catalog/products/${visibleAgain.slug}`).expect(200);
  });

  it('filters and sorts by the minimum active variant price with inclusive bounds and stable pagination', async () => {
    const category = await createCategory();
    let alpha = await addVariant(
      await createProduct(category.id, 'alpha-shirt', { name: 'Alpha Shirt' }),
      'ALPHA-INACTIVE',
      false,
      0,
    );
    alpha = await addVariant(alpha, 'ALPHA-300', true, 300);
    alpha = await addVariant(alpha, 'ALPHA-900', true, 900);
    await publish(alpha);
    await publish(
      await addVariant(
        await createProduct(category.id, 'bravo-shirt', {
          name: 'Bravo Shirt',
        }),
        'BRAVO-100',
        true,
        100,
      ),
    );
    await publish(
      await addVariant(
        await createProduct(category.id, 'charlie-shirt', {
          name: 'Charlie Shirt',
        }),
        'CHARLIE-200',
        true,
        200,
      ),
    );
    await addVariant(
      await createProduct(category.id, 'hidden-draft'),
      'DRAFT-50',
      true,
      50,
    );

    const ascending = await test
      .http()
      .get('/catalog/products')
      .query({ sort: 'price-asc', limit: 2 })
      .expect(200);
    expect(ascending.body).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      pages: 2,
    });
    expect(
      ascending.body.items.map((product: { slug: string }) => product.slug),
    ).toEqual(['bravo-shirt', 'charlie-shirt']);
    expect(
      ascending.body.items.map(
        (product: { priceFromAmount: number }) => product.priceFromAmount,
      ),
    ).toEqual([100, 200]);
    const secondPage = await test
      .http()
      .get('/catalog/products')
      .query({ sort: 'price-asc', limit: 2, page: 2 })
      .expect(200);
    expect(secondPage.body.items[0]).toMatchObject({
      slug: 'alpha-shirt',
      priceFromAmount: 300,
    });
    const descending = await test
      .http()
      .get('/catalog/products')
      .query({ sort: 'price-desc' })
      .expect(200);
    expect(
      descending.body.items.map((product: { slug: string }) => product.slug),
    ).toEqual(['alpha-shirt', 'charlie-shirt', 'bravo-shirt']);
    const alphabetical = await test
      .http()
      .get('/catalog/products')
      .query({ sort: 'name-asc' })
      .expect(200);
    expect(
      alphabetical.body.items.map((product: { slug: string }) => product.slug),
    ).toEqual(['alpha-shirt', 'bravo-shirt', 'charlie-shirt']);
    const bounded = await test
      .http()
      .get('/catalog/products')
      .query({
        minPrice: 100,
        maxPrice: 200,
        sort: 'price-asc',
        categoryId: category.id,
      })
      .expect(200);
    expect(
      bounded.body.items.map(
        (product: { priceFromAmount: number }) => product.priceFromAmount,
      ),
    ).toEqual([100, 200]);
    const exact = await test
      .http()
      .get('/catalog/products')
      .query({ minPrice: 200, maxPrice: 200, q: 'Charlie' })
      .expect(200);
    expect(exact.body).toMatchObject({ total: 1 });
    const inactiveExcluded = await test
      .http()
      .get('/catalog/products')
      .query({ minPrice: 0, maxPrice: 0 })
      .expect(200);
    expect(inactiveExcluded.body.total).toBe(0);
    const notAnyVariant = await test
      .http()
      .get('/catalog/products')
      .query({ minPrice: 500, maxPrice: 1000 })
      .expect(200);
    expect(notAnyVariant.body.total).toBe(0);
    for (const query of [
      { minPrice: 201, maxPrice: 100 },
      { minPrice: -1 },
      { maxPrice: 1.5 },
      { maxPrice: 2147483648 },
      { sort: 'arbitrary-sql' },
    ]) {
      await test.http().get('/catalog/products').query(query).expect(400);
    }
  });

  it('rejects reserved raw JSON attribute keys before transformation without changing the aggregate', async () => {
    const category = await createCategory();
    const product = await addVariant(
      await createProduct(category.id),
      'RAW-JSON-SHIRT',
      true,
      1000,
      { color: 'blue' },
    );
    const variant = product.variants[0];
    const productPath = `/admin/catalog/products/${product.id}`;
    for (const rawAttributes of [
      '{"constructor":"bad"}',
      '{"__proto__":"bad"}',
      '{"color":{"constructor":"bad"}}',
    ]) {
      const patch = await test
        .http()
        .patch(`${productPath}/variants/${variant.id}`)
        .auth(adminToken, { type: 'bearer' })
        .set('Content-Type', 'application/json')
        .send(`{"version":${product.version},"attributes":${rawAttributes}}`)
        .expect(400)
        .expect('Cache-Control', 'no-store');
      expect(patch.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_CATALOG_INPUT',
      });
      await test
        .http()
        .post(`${productPath}/variants`)
        .auth(adminToken, { type: 'bearer' })
        .set('Content-Type', 'application/json')
        .send(
          `{"version":${product.version},"sku":"RAW-REJECTED","name":"Rejected","priceAmount":1000,"attributes":${rawAttributes}}`,
        )
        .expect(400)
        .expect('Cache-Control', 'no-store');
    }
    const retained = await test
      .http()
      .get(productPath)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(retained.body).toMatchObject({ version: product.version });
    expect(retained.body.variants).toHaveLength(1);
    expect(retained.body.variants[0]).toMatchObject({
      id: variant.id,
      sku: variant.sku,
      attributes: { color: 'blue' },
    });
  });

  it('applies live administrator authorization and no-store to every added endpoint', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const user = await test.register('catalog-reader@example.com');
    const userToken = (await test.login(user.email)).accessToken;
    const routes: Array<{
      method: 'get' | 'post' | 'patch' | 'delete';
      path: string;
      body?: Record<string, unknown>;
    }> = [
      { method: 'get', path: '/admin/catalog/categories' },
      { method: 'get', path: `/admin/catalog/categories/${category.id}` },
      {
        method: 'patch',
        path: `/admin/catalog/categories/${category.id}`,
        body: { version: category.version, name: 'Forbidden' },
      },
      {
        method: 'delete',
        path: `/admin/catalog/categories/${category.id}`,
        body: { version: category.version },
      },
      {
        method: 'post',
        path: `/admin/catalog/products/${product.id}/unpublish`,
        body: { version: product.version },
      },
      {
        method: 'post',
        path: `/admin/catalog/products/${product.id}/restore`,
        body: { version: product.version },
      },
    ];
    for (const route of routes) {
      const request = test
        .http()
        [route.method](route.path)
        .auth(userToken, { type: 'bearer' });
      if (route.body) request.send(route.body);
      await request.expect(403).expect('Cache-Control', 'no-store');
    }
  });

  it('rejects a revoked administrator session through the shared Identity guard', async () => {
    await test
      .http()
      .post('/auth/logout-all')
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    await test
      .http()
      .get('/admin/catalog/products')
      .auth(adminToken, { type: 'bearer' })
      .expect(401);
    await test
      .http()
      .post('/admin/catalog/categories')
      .auth(adminToken, { type: 'bearer' })
      .send({ name: 'Rejected', slug: 'rejected' })
      .expect(401);
  });
});
