import { CatalogValidationError } from '../errors/catalog.errors.js';
import { CATALOG_LIMITS } from '../policies/catalog-input.policy.js';

export function normalizeVariantAttributes(
  value: unknown,
): Record<string, string> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new CatalogValidationError(
      'Variant attributes must be a plain object',
    );
  }
  const entries = Object.entries(value);
  if (entries.length > CATALOG_LIMITS.attributes) {
    throw new CatalogValidationError(
      'Variants may contain at most 10 attributes',
    );
  }
  const keys = new Set<string>();
  const normalized = entries.map(([rawKey, rawValue]) => {
    const key = rawKey.normalize('NFC').trim().toLowerCase().normalize('NFC');
    if (
      !key ||
      Array.from(key).length > CATALOG_LIMITS.attributeKey ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    ) {
      throw new CatalogValidationError(
        'Attribute names must contain 1 to 40 characters and cannot use reserved names',
      );
    }
    if (keys.has(key)) {
      throw new CatalogValidationError(
        'Attribute names must be unique after normalization',
      );
    }
    keys.add(key);
    if (typeof rawValue !== 'string') {
      throw new CatalogValidationError('Attribute values must be strings');
    }
    const normalizedValue = rawValue.normalize('NFC').trim();
    if (
      !normalizedValue ||
      Array.from(normalizedValue).length > CATALOG_LIMITS.attributeValue
    ) {
      throw new CatalogValidationError(
        'Attribute values must contain 1 to 80 characters',
      );
    }
    return [key, normalizedValue] as const;
  });
  return Object.fromEntries(normalized);
}

/** Empty legacy option maps have no selectable combination to reserve. */
export function variantAttributeCombination(
  attributes: Record<string, string>,
): string | null {
  const keys = Object.keys(attributes).sort();
  if (keys.length === 0) return null;
  return JSON.stringify(
    keys.map((key) => [key, attributes[key].toLowerCase().normalize('NFC')]),
  );
}
