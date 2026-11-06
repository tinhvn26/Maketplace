import { describe, expect, it, vi } from 'vitest';
import { ShopsService } from './shops.service.js';
import type { ShopRepository } from './ports/shop.repository.js';
import { createShop } from '../domain/entities/shop.js';
import {
  ShopAccessDeniedError,
  ShopValidationError,
  ShopVersionConflictError,
} from '../domain/errors/shop.errors.js';

function setup() {
  const actor = { userId: 'owner', role: 'USER' as const };
  const now = new Date('2026-11-03T01:00:00Z');
  const shop = createShop({
    id: 'shop-one',
    ownerId: actor.userId,
    name: 'My Shop',
    slug: 'my-shop',
    now,
  });
  const repo = {
    create: vi
      .fn<ShopRepository['create']>()
      .mockImplementation(async (input) => input),
    listMine: vi.fn<ShopRepository['listMine']>().mockResolvedValue([shop]),
    findPublicById: vi
      .fn<ShopRepository['findPublicById']>()
      .mockResolvedValue(shop),
    findById: vi.fn<ShopRepository['findById']>().mockResolvedValue(shop),
    requireManageable: vi
      .fn<ShopRepository['requireManageable']>()
      .mockResolvedValue(),
    assertSellable: vi
      .fn<ShopRepository['assertSellable']>()
      .mockResolvedValue(),
    requireAdministrator: vi
      .fn<ShopRepository['requireAdministrator']>()
      .mockResolvedValue(),
    save: vi.fn<ShopRepository['save']>().mockImplementation(async (input) => ({
      ...input,
      version: input.version + 1,
    })),
    saveStatus: vi
      .fn<ShopRepository['saveStatus']>()
      .mockImplementation(async (input) => ({
        ...input,
        version: input.version + 1,
      })),
  } satisfies ShopRepository;
  return {
    actor,
    now,
    shop,
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
    expect(repo.create.mock.calls[0][1]).toBe(actor);
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

  it('checks ownership before loading a private record or applying changes', async () => {
    const { service, actor, shop, repo } = setup();
    repo.requireManageable.mockRejectedValue(new ShopAccessDeniedError());
    await expect(
      service.update(shop.id, { version: 0, name: 'Denied' }, actor),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('retains the original revision and actor for the atomic persistence recheck', async () => {
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
      actor,
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
    repo.requireAdministrator.mockRejectedValue(new ShopAccessDeniedError());
    await expect(
      service.setStatus(shop.id, { version: 0, status: 'SUSPENDED' }, actor),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.saveStatus).not.toHaveBeenCalled();
  });
});
