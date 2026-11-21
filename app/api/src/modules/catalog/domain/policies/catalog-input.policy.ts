import { CatalogValidationError } from '../errors/catalog.errors.js';

export const CATALOG_LIMITS = {
  categoryName: 100,
  productName: 160,
  variantName: 120,
  description: 5000,
  slug: 180,
  sku: 64,
  variants: 50,
  images: 10,
  imageUrl: 2048,
  imageAlt: 200,
  attributes: 10,
  attributeKey: 40,
  attributeValue: 80,
} as const;

export function catalogName(value: unknown, maximum: number): string {
  if (typeof value !== 'string') {
    throw new CatalogValidationError('Name must be a string');
  }
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > maximum) {
    throw new CatalogValidationError(
      `Name must contain 1 to ${maximum} characters`,
    );
  }
  return normalized;
}

export function catalogSlug(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CatalogValidationError('Slug must be a string');
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length > CATALOG_LIMITS.slug ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)
  ) {
    throw new CatalogValidationError(
      'Slug must contain lowercase letters, digits and single separating hyphens, up to 180 characters',
    );
  }
  return normalized;
}

export function catalogSku(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CatalogValidationError('SKU must be a string');
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(normalized)) {
    throw new CatalogValidationError(
      'SKU must start with a letter or digit and contain up to 64 letters, digits, dots, underscores or hyphens',
    );
  }
  return normalized;
}

export function catalogDescription(value: unknown): string {
  if (
    typeof value !== 'string' ||
    Array.from(value).length > CATALOG_LIMITS.description
  ) {
    throw new CatalogValidationError(
      'Description must be a string containing at most 5000 characters',
    );
  }
  return value;
}

export function catalogId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CatalogValidationError(
      'A nonempty catalog identifier is required',
    );
  }
  return value.trim();
}

export function catalogDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new CatalogValidationError('A valid catalog timestamp is required');
  }
  return new Date(value.getTime());
}
