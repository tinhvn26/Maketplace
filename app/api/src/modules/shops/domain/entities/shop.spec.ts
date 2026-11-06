import { describe, expect, it } from 'vitest';
import {
  assertShopVersion,
  changeShopStatus,
  createShop,
  updateShop,
} from './shop.js';
import { ShopValidationError } from '../errors/shop.errors.js';
import {
  isActiveShopAccount,
  mayManageShop,
} from '../policies/shop-access.policy.js';

const now = new Date('2026-11-03T01:00:00Z');
const later = new Date('2026-11-03T02:00:00Z');
const input = {
  id: 'shop-one',
  ownerId: 'owner-one',
  name: '  Cửa hàng mới  ',
  slug: ' MY-SHOP ',
  now,
};

describe('Shop domain', () => {
  it('normalizes details, creates an active initial revision and copies dates', () => {
    const date = new Date(now);
    const shop = createShop({ ...input, now: date });
    date.setTime(0);
    expect(shop).toEqual({
      id: input.id,
      ownerId: input.ownerId,
      name: 'Cửa hàng mới',
      slug: 'my-shop',
      status: 'ACTIVE',
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('updates allowed details without replacing ownership, status or version', () => {
    const shop = { ...createShop(input), version: 12 };
    const changed = updateShop(
      shop,
      {
        name: ' New name ',
        slug: ' NEW-SLUG ',
        ownerId: 'attacker',
        status: 'SUSPENDED',
        version: 99,
      } as { name: string; slug: string },
      later,
    );
    expect(changed).toMatchObject({
      ownerId: input.ownerId,
      name: 'New name',
      slug: 'new-slug',
      status: 'ACTIVE',
      version: 12,
      createdAt: now,
      updatedAt: later,
    });
    changed.createdAt.setTime(0);
    expect(shop.createdAt).toEqual(now);
    expect(shop.name).toBe('Cửa hàng mới');
  });

  it('changes status explicitly and retains ownership and the CAS revision', () => {
    const shop = createShop(input);
    const suspended = changeShopStatus(shop, 'SUSPENDED', later);
    expect(suspended).toMatchObject({
      ownerId: input.ownerId,
      status: 'SUSPENDED',
      version: 0,
    });
    expect(changeShopStatus(suspended, 'ACTIVE', later).status).toBe('ACTIVE');
    expect(() => changeShopStatus(shop, 'DELETED' as 'ACTIVE', later)).toThrow(
      ShopValidationError,
    );
  });

  it('counts Unicode names and accepts the maximum slug length', () => {
    expect(
      createShop({ ...input, name: '🙂'.repeat(100), slug: 'a'.repeat(180) })
        .name,
    ).toBe('🙂'.repeat(100));
    expect(() => createShop({ ...input, name: '🙂'.repeat(101) })).toThrow(
      ShopValidationError,
    );
    expect(() => createShop({ ...input, slug: 'a'.repeat(181) })).toThrow(
      ShopValidationError,
    );
  });

  it.each([
    { name: '  ' },
    { slug: 'bad slug' },
    { slug: 'double--dash' },
    { ownerId: '' },
    { id: '' },
    { now: new Date(NaN) },
  ])('rejects invalid creation fields: %j', (changes) => {
    expect(() => createShop({ ...input, ...changes })).toThrow(
      ShopValidationError,
    );
  });

  it.each([{}, { name: undefined }, { name: null }, { slug: null }, null])(
    'rejects empty/null updates without changing the original: %j',
    (changes) => {
      const shop = createShop(input);
      const before = { ...shop };
      expect(() =>
        updateShop(
          shop,
          changes as unknown as { name?: string; slug?: string },
          later,
        ),
      ).toThrow(ShopValidationError);
      expect(shop).toEqual(before);
    },
  );

  it.each([-1, 0.5, NaN, 2_147_483_647])(
    'rejects invalid expected versions: %s',
    (version) => {
      expect(() => assertShopVersion(version)).toThrow(ShopValidationError);
    },
  );

  it('allows only live owners and administrators to manage a shop', () => {
    const owner = {
      id: input.ownerId,
      role: 'USER',
      status: 'ACTIVE',
      deletedAt: null,
    };
    expect(mayManageShop(input.ownerId, owner)).toBe(true);
    expect(mayManageShop(input.ownerId, { ...owner, id: 'other' })).toBe(false);
    expect(
      mayManageShop(input.ownerId, { ...owner, id: 'admin', role: 'ADMIN' }),
    ).toBe(true);
    expect(mayManageShop(input.ownerId, { ...owner, status: 'LOCKED' })).toBe(
      false,
    );
    expect(mayManageShop(input.ownerId, { ...owner, deletedAt: now })).toBe(
      false,
    );
    expect(isActiveShopAccount({ ...owner, role: 'UNSUPPORTED' })).toBe(false);
    expect(isActiveShopAccount(null)).toBe(false);
  });
});
