import { describe, expect, it } from 'vitest';
import { CatalogValidationError } from '../errors/catalog.errors.js';
import { createCategory, updateCategory } from './category.js';

const now = new Date('2026-10-27T00:00:00.000Z');
const input = {
  id: 'category-one',
  name: ' Thực phẩm ',
  slug: ' FRESH-FOOD ',
  now,
};

describe('Category', () => {
  it('normalizes names and slugs while preserving the supplied identity', () => {
    expect(createCategory(input)).toEqual({
      id: 'category-one',
      name: 'Thực phẩm',
      slug: 'fresh-food',
      version: 0,
      createdAt: now,
      parentId: null,
      attributeDefinitions: [],
    });
  });

  it('counts Unicode characters at the name boundary and copies its timestamp', () => {
    const sourceDate = new Date(now);
    const category = createCategory({
      ...input,
      name: '🙂'.repeat(100),
      now: sourceDate,
    });
    sourceDate.setTime(0);
    expect(category.createdAt).toEqual(now);
    expect(category.name).toBe('🙂'.repeat(100));
    expect(() => createCategory({ ...input, name: '🙂'.repeat(101) })).toThrow(
      CatalogValidationError,
    );
  });

  it.each([
    { id: '' },
    { name: '   ' },
    { slug: 'two--hyphens' },
    { slug: '-leading' },
    { slug: 'trailing-' },
    { slug: 'not a slug' },
    { slug: 'đồ-ăn' },
    { slug: 'a'.repeat(181) },
    { now: new Date(NaN) },
  ])('rejects invalid category input: %j', (changes) => {
    expect(() => createCategory({ ...input, ...changes })).toThrow(
      CatalogValidationError,
    );
  });

  it('updates known category details without changing identity, creation time or version', () => {
    const category = { ...createCategory(input), version: 12 };
    const changes = {
      name: ' Bakery ',
      slug: ' FRESH-BAKERY ',
      id: 'smuggled',
      version: 99,
    };
    const result = updateCategory(category, changes);
    expect(result).toEqual({
      ...category,
      name: 'Bakery',
      slug: 'fresh-bakery',
    });
    expect(category.name).toBe('Thực phẩm');
    result.createdAt.setTime(0);
    expect(category.createdAt).toEqual(now);
  });

  it.each([
    {},
    { name: undefined },
    null,
    { name: null },
    { slug: null },
    { name: 'Valid', slug: 'invalid slug' },
  ])(
    'rejects empty or invalid category updates without changing the original: %j',
    (changes) => {
      const category = createCategory(input);
      const before = { ...category, createdAt: new Date(category.createdAt) };
      expect(() =>
        updateCategory(
          category,
          changes as unknown as { name?: string; slug?: string },
        ),
      ).toThrow(CatalogValidationError);
      expect(category).toEqual(before);
    },
  );
});
