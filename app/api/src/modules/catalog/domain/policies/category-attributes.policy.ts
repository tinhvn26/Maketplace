import { CatalogValidationError } from '../errors/catalog.errors.js';
import { normalizeVariantAttributes } from '../value-objects/variant-attributes.js';

export interface CategoryAttributeDefinition {
  key: string;
  values: string[];
  required: boolean;
}

export function normalizeCategoryAttributeDefinitions(
  value: unknown,
): CategoryAttributeDefinition[] {
  if (!Array.isArray(value) || value.length > 10)
    throw new CatalogValidationError(
      'Categories support at most 10 option definitions',
    );
  const keys = new Set<string>();
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new CatalogValidationError('Invalid category option definition');
    const definition = item as Record<string, unknown>;
    if (
      typeof definition.key !== 'string' ||
      typeof definition.required !== 'boolean' ||
      !Array.isArray(definition.values) ||
      definition.values.length === 0 ||
      definition.values.length > 50
    )
      throw new CatalogValidationError(
        'Category options require a key, 1 to 50 enum values and a boolean required flag',
      );
    const key = Object.keys(
      normalizeVariantAttributes({ [definition.key]: 'option' }),
    )[0];
    if (keys.has(key))
      throw new CatalogValidationError('Category option keys must be unique');
    keys.add(key);
    const seen = new Set<string>();
    const values = definition.values.map((entry: unknown) => {
      const normalized = normalizeVariantAttributes({ [key]: entry })[key];
      const identity = normalized.toLowerCase().normalize('NFC');
      if (seen.has(identity))
        throw new CatalogValidationError(
          'Category option enum values must be unique',
        );
      seen.add(identity);
      return normalized;
    });
    return { key, values, required: definition.required };
  });
}

export function validateVariantsForCategory(
  category: { attributeDefinitions?: CategoryAttributeDefinition[] },
  variants: Array<{ attributes?: Record<string, string> }>,
): void {
  const definitions = normalizeCategoryAttributeDefinitions(
    category.attributeDefinitions ?? [],
  );
  if (definitions.length === 0) return;
  const known = new Map(
    definitions.map((definition) => [definition.key, definition]),
  );
  for (const variant of variants) {
    const attributes = normalizeVariantAttributes(variant.attributes ?? {});
    for (const key of Object.keys(attributes))
      if (!known.has(key))
        throw new CatalogValidationError(
          `Attribute ${key} is not defined by this category`,
        );
    for (const definition of definitions) {
      const value = attributes[definition.key];
      if (value === undefined) {
        if (definition.required)
          throw new CatalogValidationError(
            `Attribute ${definition.key} is required by this category`,
          );
      } else if (
        !definition.values.some(
          (option) =>
            option.toLowerCase().normalize('NFC') ===
            value.toLowerCase().normalize('NFC'),
        )
      ) {
        throw new CatalogValidationError(
          `Attribute ${definition.key} is not an allowed category option`,
        );
      }
    }
  }
}
