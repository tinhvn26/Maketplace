import { describe, expect, it } from 'vitest';
import {
  normalizeCategoryAttributeDefinitions,
  validateVariantsForCategory,
} from './category-attributes.policy.js';
import { CatalogValidationError } from '../errors/catalog.errors.js';

describe('Category enum attributes', () => {
  const definitions = [{ key: ' Size ', values: [' S ', 'M'], required: true }];
  it('normalizes definitions and copies caller-owned enum arrays', () => {
    const result = normalizeCategoryAttributeDefinitions(definitions);
    expect(result).toEqual([
      { key: 'size', values: ['S', 'M'], required: true },
    ]);
    result[0].values.push('L');
    expect(definitions[0].values).toEqual([' S ', 'M']);
  });
  it('validates required keys and enum choices while allowing normalized casing', () => {
    const category = {
      attributeDefinitions: normalizeCategoryAttributeDefinitions(definitions),
    };
    expect(() =>
      validateVariantsForCategory(category, [{ attributes: { SIZE: ' m ' } }]),
    ).not.toThrow();
    const invalid: Array<Record<string, string>> = [
      {},
      { size: 'L' },
      { size: 'M', color: 'red' },
    ];
    for (const attributes of invalid) {
      expect(() =>
        validateVariantsForCategory(category, [{ attributes }]),
      ).toThrow(CatalogValidationError);
    }
    expect(() =>
      validateVariantsForCategory({}, [
        { attributes: { legacy: 'free-form' } },
      ]),
    ).not.toThrow();
  });
  it.each([
    [{ key: 'size', values: ['M', 'm'], required: true }],
    [{ key: '__proto__', values: ['M'], required: true }],
    [{ key: 'size', values: [], required: false }],
    [{ key: 'size', values: ['M'], required: 'yes' }],
    [
      { key: 'Size', values: ['M'], required: true },
      { key: 'size', values: ['L'], required: false },
    ],
  ])('rejects ambiguous or malformed definitions: %j', (...input) => {
    expect(() => normalizeCategoryAttributeDefinitions(input)).toThrow(
      CatalogValidationError,
    );
  });
});
