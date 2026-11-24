import { describe, expect, it, vi } from 'vitest';
import { ShopsService } from './shops.service.js';
import type { ShopRepository, ShopStore } from './ports/shop.repository.js';
import { createShop } from '../domain/entities/shop.js';
import type { Shop } from '../domain/entities/shop.js';
import type { ShopAccount } from '../domain/policies/shop-access.policy.js';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
  ShopValidationError,
  ShopVersionConflictError,
} from '../domain/errors/shop.errors.js';

function setup() {
  const actor = { userId: 'owner', role: 'CUSTOMER' as const };
  const admin = { userId: 'admin', role: 'ADMIN' as const };
  const now = new Date('2026-11-03T01:00:00Z');
  const shop = createShop({
    id: 'shop-one',
    ownerId: actor.userId,
    name: 'My Shop',
    slug: 'my-shop',
    now,
  });
  const state = { shop, ownerActive: true };
  const accounts = new Map<string, ShopAccount>([
    ['owner', { id: 'owner', role: 'CUSTOMER' }],
    ['other', { id: 'other', role: 'CUSTOMER' }],
    ['admin', { id: 'admin', role: 'ADMIN' }],
  ]);
  const bump = async (input: Shop) => ({
    ...input,
    version: input.version + 1,
  });
  const store = {
    findActiveAccount: vi.fn<ShopStore['findActiveAccount']>(async (a) => {
      const account = accounts.get(a.userId);
      return account && account.role === a.role ? account : null;
    }),
    findById: vi.fn<ShopStore['findById']>(async (id) =>
      id === state.shop.id ? state.shop : null,
    ),
    findWithOwnerState: vi.fn<ShopStore['findWithOwnerState']>(async (id) =>
      id === state.shop.id ? { ...state } : null,
    ),
    findManyWithOwnerState: vi.fn<ShopStore['findManyWithOwnerState']>(
      async (ids) => (ids.includes(state.shop.id) ? [{ ...state }] : []),
    ),
    listByOwner: vi.fn<ShopStore['listByOwner']>(async () => [state.shop]),
    insert: vi.fn<ShopStore['insert']>(async (input) => input),
    save: vi.fn<ShopStore['save']>(bump),
    saveStatus: vi.fn<ShopStore['saveStatus']>(bump),
  } satisfies ShopStore;
  const transaction = vi.fn(
    (_actorId: string, work: (tx: ShopStore) => Promise<unknown>) =>
      work(store),
  );
  const repo = {
    ...store,
    // vi.fn cannot express the generic signature; the runtime behaviour matches.
    transaction: transaction as typeof transaction &
      ShopRepository['transaction'],
  } satisfies ShopRepository;
  return {
    actor,
    admin,
    now,
    shop,
    state,
    accounts,
    repo,
    service: new ShopsService(
      repo,
      { next: () => shop.id },
      { now: () => now },
    ),
  };
}

describe('ShopsService', () => {
  it('creates shops for the authenticated actor, ignoring supplied owner or status fields', async () => {
    const { service, actor, repo } = setup();
    const input = {
      name: ' New Shop ',
      slug: ' NEW-SHOP ',
      ownerId: 'attacker',
      status: 'SUSPENDED',
      version: 99,
    };
    await expect(service.create(input, actor)).resolves.toMatchObject({
      ownerId: actor.userId,
      name: 'New Shop',
      slug: 'new-shop',
      status: 'ACTIVE',
      version: 0,
    });
    expect(repo.transaction.mock.calls[0][0]).toBe(actor.userId);
  });

  it('rejects an actor whose role no longer matches before writing', async () => {
    const { service, actor, repo } = setup();
    await expect(
      service.create(
        { name: 'Shop', slug: 'shop' },
        { ...actor, role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('omits owner identifiers, status and revision from the public projection', async () => {
    const { service, shop } = setup();
    const result = await service.getPublic(shop.id);
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'name', 'slug', 'createdAt', 'updatedAt'].sort(),
    );
    result.createdAt.setTime(0);
    expect(shop.createdAt.getTime()).not.toBe(0);
  });

  it('hides a shop whose owner is no longer active from the public', async () => {
    const { service, shop, state } = setup();
    state.ownerActive = false;
    await expect(service.getPublic(shop.id)).rejects.toBeInstanceOf(
      ShopNotFoundError,
    );
  });

  it('checks ownership inside the write transaction before saving', async () => {
    const { service, shop, repo } = setup();
    await expect(
      service.update(
        shop.id,
        { version: 0, name: 'Denied' },
        { userId: 'other', role: 'CUSTOMER' },
      ),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(repo.transaction).toHaveBeenCalledWith(
      'other',
      expect.any(Function),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses to edit a suspended shop', async () => {
    const { service, actor, shop, state, repo } = setup();
    state.shop = { ...shop, status: 'SUSPENDED' };
    await expect(
      service.update(shop.id, { version: 0, name: 'Renamed' }, actor),
    ).rejects.toBeInstanceOf(ShopUnavailableError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('saves the candidate against the revision the client read', async () => {
    const { service, actor, shop, repo } = setup();
    await expect(
      service.update(shop.id, { version: 0, name: 'Renamed' }, actor),
    ).resolves.toMatchObject({ name: 'Renamed', version: 1 });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: shop.id,
        ownerId: actor.userId,
        version: 0,
      }),
      0,
    );
  });

  it('rejects stale or empty updates without saving', async () => {
    const { service, actor, shop, repo } = setup();
    await expect(
      service.update(shop.id, { version: 1, name: 'Stale' }, actor),
    ).rejects.toBeInstanceOf(ShopVersionConflictError);
    await expect(
      service.update(shop.id, { version: 0 }, actor),
    ).rejects.toBeInstanceOf(ShopValidationError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('requires administrator privileges for status changes', async () => {
    const { service, actor, shop, repo } = setup();
    await expect(
      service.setStatus(shop.id, { version: 0, status: 'SUSPENDED' }, actor),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.saveStatus).not.toHaveBeenCalled();
  });

  it('lets an administrator suspend a shop', async () => {
    const { service, admin, shop } = setup();
    await expect(
      service.setStatus(shop.id, { version: 0, status: 'SUSPENDED' }, admin),
    ).resolves.toMatchObject({ status: 'SUSPENDED', version: 1 });
  });

  it('reports unsellable or unknown shops through ShopAccess', async () => {
    const { service, shop, state } = setup();
    await expect(service.assertSellable([shop.id, shop.id])).resolves.toBe(
      undefined,
    );
    await expect(
      service.assertSellable([shop.id, 'missing']),
    ).rejects.toBeInstanceOf(ShopUnavailableError);
    state.ownerActive = false;
    await expect(service.assertSellable([shop.id])).rejects.toBeInstanceOf(
      ShopUnavailableError,
    );
  });
});
