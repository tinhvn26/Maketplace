import { describe, expect, it, vi } from 'vitest';
import { Product } from '../../domain/entities/product.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogStateError,
  CatalogValidationError,
  CatalogVersionConflictError,
} from '../../domain/errors/catalog.errors.js';
import type { CatalogAdminRepository } from '../ports/catalog.repository.js';
import { CatalogAdminService } from './catalog-admin.service.js';

const now = new Date('2026-10-27T08:00:00.000Z');
const CONTEXT = {
  actor: { userId: 'admin', role: 'ADMIN' as const },
  action: 'TEST',
};

function setup() {
  const category = {
    id: 'category',
    name: 'Áo',
    slug: 'ao',
    version: 0,
    createdAt: now,
  };
  const product = Product.create({
    id: 'product',
    categoryId: category.id,
    name: 'Áo thun',
    slug: 'ao-thun',
    now,
  });
  const repository = {
    listCategories: vi
      .fn<CatalogAdminRepository['listCategories']>()
      .mockResolvedValue([category]),
    findCategoryById: vi
      .fn<CatalogAdminRepository['findCategoryById']>()
      .mockResolvedValue(category),
    createCategory: vi
      .fn<CatalogAdminRepository['createCategory']>()
      .mockImplementation(async (value) => value),
    saveCategory: vi
      .fn<CatalogAdminRepository['saveCategory']>()
      .mockImplementation(async (value, version) => ({
        ...value,
        version: version + 1,
      })),
    deleteCategory: vi
      .fn<CatalogAdminRepository['deleteCategory']>()
      .mockResolvedValue(undefined),
    findProductById: vi
      .fn<CatalogAdminRepository['findProductById']>()
      .mockResolvedValue(product.toSnapshot()),
    listAdminProducts: vi
      .fn<CatalogAdminRepository['listAdminProducts']>()
      .mockResolvedValue({ items: [product.toSnapshot()], total: 1 }),
    createProduct: vi
      .fn<CatalogAdminRepository['createProduct']>()
      .mockImplementation(async (value) => value),
    saveProduct: vi
      .fn<CatalogAdminRepository['saveProduct']>()
      .mockImplementation(async (value, version) => ({
        ...value,
        version: version + 1,
      })),
  } satisfies CatalogAdminRepository;
  const ids = { next: vi.fn(() => 'generated-id') };
  const clock = { now: () => new Date(now) };
  return {
    repository,
    product,
    ids,
    service: new CatalogAdminService(repository, ids, clock),
  };
}

describe('CatalogAdminService', () => {
  it('creates a normalized category using injected identity and time', async () => {
    const { service } = setup();
    await expect(
      service.createCategory({ name: ' Áo ', slug: ' AO ' }, CONTEXT),
    ).resolves.toEqual({
      id: 'generated-id',
      name: 'Áo',
      slug: 'ao',
      version: 0,
      createdAt: now,
      parentId: null,
      attributeDefinitions: [],
    });
  });

  it('does not create a product that references a missing category', async () => {
    const { service, repository } = setup();
    repository.findCategoryById.mockResolvedValue(null);
    await expect(
      service.createProduct(
        { categoryId: 'missing', name: 'Áo', slug: 'ao' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(CatalogNotFoundError);
    expect(repository.createProduct).not.toHaveBeenCalled();
  });

  it('creates products only as drafts without trusting extra runtime fields', async () => {
    const { service, repository } = setup();
    const input = {
      categoryId: 'category',
      name: 'Áo',
      slug: 'ao',
      status: 'PUBLISHED',
      version: 99,
    };
    await expect(service.createProduct(input, CONTEXT)).resolves.toMatchObject({
      status: 'DRAFT',
      version: 0,
      variants: [],
    });
    expect(repository.createProduct).toHaveBeenCalledOnce();
  });

  it('uses the normalized category identifier for existence checks and storage', async () => {
    const { service, repository } = setup();
    await expect(
      service.createProduct(
        {
          categoryId: ' category ',
          name: 'Áo',
          slug: 'ao',
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({ categoryId: 'category' });
    expect(repository.findCategoryById).toHaveBeenCalledExactlyOnceWith(
      'category',
    );
  });

  it('validates category changes before making persistence calls for non-HTTP callers', async () => {
    const { service, repository } = setup();
    await expect(
      service.updateProduct(
        'product',
        {
          version: 0,
          categoryId: null as unknown as string,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(CatalogValidationError);
    expect(repository.findCategoryById).not.toHaveBeenCalled();
    expect(repository.saveProduct).not.toHaveBeenCalled();
  });

  it('rejects an empty product identifier before querying persistence', async () => {
    const { service, repository } = setup();
    await expect(service.getProduct(' ')).rejects.toBeInstanceOf(
      CatalogValidationError,
    );
    expect(repository.findProductById).not.toHaveBeenCalled();
  });

  it('adds a stable variant and passes the original aggregate version to atomic save', async () => {
    const { service, repository } = setup();
    const result = await service.addVariant(
      'product',
      {
        version: 0,
        sku: ' ao-den-m ',
        name: 'Đen / M',
        priceAmount: 150000,
      },
      CONTEXT,
    );
    expect(result.version).toBe(1);
    expect(result.variants).toEqual([
      {
        id: 'generated-id',
        sku: 'AO-DEN-M',
        name: 'Đen / M',
        priceAmount: 150000,
        currency: 'VND',
        isActive: true,
        attributes: {},
      },
    ]);
    expect(repository.saveProduct).toHaveBeenCalledWith(
      expect.objectContaining({ version: 0 }),
      0,
      CONTEXT,
    );
  });

  it('updates category details with optimistic concurrency and normalized values', async () => {
    const { service, repository } = setup();
    await expect(
      service.updateCategory(
        'category',
        {
          version: 0,
          name: ' Áo mới ',
          slug: ' AO-MOI ',
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({
      id: 'category',
      name: 'Áo mới',
      slug: 'ao-moi',
      version: 1,
    });
    expect(repository.saveCategory).toHaveBeenCalledWith(
      expect.objectContaining({ version: 0 }),
      0,
      CONTEXT,
    );
  });

  it('does not save a stale category or an empty category update', async () => {
    const { service, repository } = setup();
    await expect(
      service.updateCategory('category', { version: 1, name: 'New' }, CONTEXT),
    ).rejects.toBeInstanceOf(CatalogVersionConflictError);
    await expect(
      service.updateCategory('category', { version: 0 }, CONTEXT),
    ).rejects.toBeInstanceOf(CatalogValidationError);
    expect(repository.saveCategory).not.toHaveBeenCalled();
  });

  it('deletes categories through the atomic versioned repository contract', async () => {
    const { service, repository } = setup();
    await service.deleteCategory(' category ', { version: 0 }, CONTEXT);
    expect(repository.deleteCategory).toHaveBeenCalledExactlyOnceWith(
      'category',
      0,
      CONTEXT,
    );
  });

  it('keeps a referenced category when persistence reports it is in use', async () => {
    const { service, repository } = setup();
    const conflict = new CatalogConflictError('Category contains products');
    repository.deleteCategory.mockRejectedValue(conflict);
    await expect(
      service.deleteCategory('category', { version: 0 }, CONTEXT),
    ).rejects.toBe(conflict);
  });

  it('passes ordered images through the aggregate and supports clearing them', async () => {
    const { service, repository } = setup();
    const created = await service.createProduct(
      {
        categoryId: 'category',
        name: 'Áo',
        slug: 'ao',
        images: [{ url: 'https://example.com/cover.jpg', alt: 'Ảnh bìa' }],
      },
      CONTEXT,
    );
    expect(created.images).toEqual([
      { url: 'https://example.com/cover.jpg', alt: 'Ảnh bìa' },
    ]);
    repository.findProductById.mockResolvedValue(created);
    await expect(
      service.updateProduct(created.id, { version: 0, images: [] }, CONTEXT),
    ).resolves.toMatchObject({ images: [], version: 1 });
  });

  it('persists structured attributes on variants without replacing their identity', async () => {
    const { service, repository } = setup();
    const added = await service.addVariant(
      'product',
      {
        version: 0,
        sku: 'AO-M',
        name: 'M',
        priceAmount: 150000,
        attributes: { ' Size ': ' M ' },
      },
      CONTEXT,
    );
    expect(added.variants[0].attributes).toEqual({ size: 'M' });
    repository.findProductById.mockResolvedValue(added);
    const changed = await service.updateVariant(
      'product',
      added.variants[0].id,
      { version: 1, attributes: { size: 'L' } },
      CONTEXT,
    );
    expect(changed.variants[0]).toMatchObject({
      id: added.variants[0].id,
      sku: 'AO-M',
      attributes: { size: 'L' },
    });
    expect(changed.version).toBe(2);
  });

  it.each(['unpublish', 'restore'] as const)(
    'returns %s products to draft through a versioned save',
    async (operation) => {
      const { service, repository, product } = setup();
      product.addVariant(
        { id: 'variant', sku: 'AO-M', name: 'M', priceAmount: 150000 },
        now,
      );
      product.publish(now);
      if (operation === 'restore') product.archive(now);
      repository.findProductById.mockResolvedValue(product.toSnapshot());
      const result =
        operation === 'unpublish'
          ? await service.unpublishProduct('product', { version: 0 }, CONTEXT)
          : await service.restoreProduct('product', { version: 0 }, CONTEXT);
      expect(result).toMatchObject({
        status: 'DRAFT',
        publishedAt: null,
        version: 1,
      });
      expect(result.variants[0]).toMatchObject({ id: 'variant', sku: 'AO-M' });
      expect(repository.saveProduct).toHaveBeenCalledWith(
        expect.objectContaining({ version: 0 }),
        0,
        CONTEXT,
      );
    },
  );

  it('rejects a stale client version before changing or saving the aggregate', async () => {
    const { service, repository } = setup();
    await expect(
      service.updateProduct(
        'product',
        { version: 1, name: 'Changed' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(CatalogVersionConflictError);
    expect(repository.saveProduct).not.toHaveBeenCalled();
  });

  it('propagates a storage conflict when another writer wins after the read', async () => {
    const { service, repository } = setup();
    const conflict = new CatalogVersionConflictError();
    repository.saveProduct.mockRejectedValue(conflict);
    await expect(
      service.updateProduct(
        'product',
        { version: 0, name: 'Changed' },
        CONTEXT,
      ),
    ).rejects.toBe(conflict);
    expect(repository.saveProduct).toHaveBeenCalledOnce();
  });

  it('does not save a published product without a sellable variant', async () => {
    const { service, repository } = setup();
    await expect(
      service.publishProduct('product', { version: 0 }, CONTEXT),
    ).rejects.toBeInstanceOf(CatalogStateError);
    expect(repository.saveProduct).not.toHaveBeenCalled();
  });

  it('does not disable the last active variant of a published product', async () => {
    const { service, repository, product } = setup();
    product.addVariant(
      { id: 'variant', sku: 'AO-M', name: 'M', priceAmount: 100000 },
      now,
    );
    product.publish(now);
    repository.findProductById.mockResolvedValue(product.toSnapshot());
    await expect(
      service.updateVariant(
        'product',
        'variant',
        {
          version: 0,
          isActive: false,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(CatalogStateError);
    expect(repository.saveProduct).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, NaN, 2147483647])(
    'rejects invalid version %s without storage access',
    async (version) => {
      const { service, repository } = setup();
      await expect(
        service.archiveProduct('product', { version }, CONTEXT),
      ).rejects.toBeInstanceOf(CatalogValidationError);
      expect(repository.findProductById).not.toHaveBeenCalled();
    },
  );

  it('does not update the category when the replacement category is missing', async () => {
    const { service, repository } = setup();
    repository.findCategoryById.mockResolvedValue(null);
    await expect(
      service.updateProduct(
        'product',
        { version: 0, categoryId: 'missing' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(CatalogNotFoundError);
    expect(repository.saveProduct).not.toHaveBeenCalled();
  });

  it.each([
    { page: 0, limit: 20 },
    { page: 1, limit: 101 },
    { page: 1.5, limit: 20 },
    { page: 2147483648, limit: 100 },
    { page: 1, limit: 20, q: 'x'.repeat(101) },
    { page: 1, limit: 20, status: 'UNKNOWN' },
  ])('validates administrative queries before storage: %j', async (query) => {
    const { service, repository } = setup();
    await expect(
      service.listProducts(
        query as Parameters<CatalogAdminService['listProducts']>[0],
      ),
    ).rejects.toBeInstanceOf(CatalogValidationError);
    expect(repository.listAdminProducts).not.toHaveBeenCalled();
  });
});
