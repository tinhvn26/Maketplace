import { ShopValidationError } from '../errors/shop.errors.js';

export type ShopStatus = 'ACTIVE' | 'SUSPENDED';

export interface Shop {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  status: ShopStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function shopId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new ShopValidationError('A shop or account identifier is required');
  return value.trim();
}

function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value.trim()).length > 100
  )
    throw new ShopValidationError('Shop name must contain 1 to 100 characters');
  return value.trim();
}

function slug(value: unknown): string {
  if (typeof value !== 'string')
    throw new ShopValidationError('Shop slug must be a string');
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 180 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized))
    throw new ShopValidationError(
      'Shop slug must contain at most 180 letters, digits and separating hyphens',
    );
  return normalized;
}

function date(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new ShopValidationError('A valid shop timestamp is required');
  return new Date(value.getTime());
}

export function assertShopVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0 || version > 2_147_483_646)
    throw new ShopValidationError('Version must be a nonnegative integer');
}

export function createShop(input: {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  now: Date;
}): Shop {
  return {
    id: shopId(input.id),
    ownerId: shopId(input.ownerId),
    name: name(input.name),
    slug: slug(input.slug),
    status: 'ACTIVE',
    version: 0,
    createdAt: date(input.now),
    updatedAt: date(input.now),
  };
}

export function updateShop(
  shop: Shop,
  changes: { name?: string; slug?: string },
  now: Date,
): Shop {
  if (
    typeof changes !== 'object' ||
    changes === null ||
    (changes.name === undefined && changes.slug === undefined)
  )
    throw new ShopValidationError('Provide at least one shop detail to update');
  return {
    ...shop,
    name: changes.name === undefined ? shop.name : name(changes.name),
    slug: changes.slug === undefined ? shop.slug : slug(changes.slug),
    createdAt: date(shop.createdAt),
    updatedAt: date(now),
  };
}

export function changeShopStatus(
  shop: Shop,
  status: ShopStatus,
  now: Date,
): Shop {
  if (status !== 'ACTIVE' && status !== 'SUSPENDED')
    throw new ShopValidationError('Unsupported shop status');
  return {
    ...shop,
    status,
    createdAt: date(shop.createdAt),
    updatedAt: date(now),
  };
}
