import { describe, expect, it } from 'vitest';
import { CatalogValidationError } from '../errors/catalog.errors.js';
import {
  normalizeVariantAttributes,
  variantAttributeCombination,
} from './variant-attributes.js';

describe('variant attributes', () => {
  it('normalizes keys and values to NFC, trims both and preserves display-value case', () => {
    expect(
      normalizeVariantAttributes({
        ' COLOR ': ' Black ',
        ' Cafe\u0301 ': ' Cafe\u0301 ',
      }),
    ).toEqual({ color: 'Black', café: 'Café' });
  });

  it('compares selectable combinations without depending on input order or letter case', () => {
    const first = normalizeVariantAttributes({ SIZE: ' M ', COLOR: ' Black ' });
    const second = normalizeVariantAttributes({ color: 'black', size: 'm' });
    expect(variantAttributeCombination(first)).toBe(
      variantAttributeCombination(second),
    );
    expect(variantAttributeCombination({})).toBeNull();
  });

  it.each([
    { COLOR: 'Black', ' color ': 'Blue' },
    { 'Cafe\u0301': 'Coffee', Café: 'Other' },
    Object.fromEntries([['__proto__', 'polluted']]),
    { CONSTRUCTOR: 'dangerous' },
    { ' prototype ': 'dangerous' },
  ])('rejects duplicate normalized or reserved keys: %j', (attributes) => {
    expect(() => normalizeVariantAttributes(attributes)).toThrow(
      CatalogValidationError,
    );
  });

  it('bounds attribute count and Unicode key/value lengths', () => {
    const ten = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`key${index}`, 'value']),
    );
    expect(Object.keys(normalizeVariantAttributes(ten))).toHaveLength(10);
    expect(() =>
      normalizeVariantAttributes({ ...ten, extra: 'value' }),
    ).toThrow(CatalogValidationError);
    expect(
      normalizeVariantAttributes({ ['🙂'.repeat(40)]: '🙂'.repeat(80) }),
    ).toEqual({ ['🙂'.repeat(40)]: '🙂'.repeat(80) });
    expect(() =>
      normalizeVariantAttributes({ ['🙂'.repeat(41)]: 'value' }),
    ).toThrow(CatalogValidationError);
    expect(() =>
      normalizeVariantAttributes({ color: '🙂'.repeat(81) }),
    ).toThrow(CatalogValidationError);
  });

  it.each([
    null,
    [],
    'color',
    { ' ': 'value' },
    { color: ' ' },
    { color: 12 },
    { color: {} },
    new Date(),
  ])('rejects invalid attribute maps or values: %j', (attributes) => {
    expect(() => normalizeVariantAttributes(attributes)).toThrow(
      CatalogValidationError,
    );
  });

  it('copies a null-prototype input into a safe ordinary object', () => {
    const input: Record<string, string> = Object.create(null);
    input.color = 'Black';
    const result = normalizeVariantAttributes(input);
    input.color = 'Changed';
    expect(result).toEqual({ color: 'Black' });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
