import { describe, expect, it } from 'vitest';
import { CatalogValidationError } from '../errors/catalog.errors.js';
import { normalizeProductImages } from './product-image.js';

describe('product images', () => {
  it('canonicalizes URLs, retains order and defaults alternative text', () => {
    expect(
      normalizeProductImages([
        { url: ' HTTP://EXAMPLE.COM:80/front.png ', alt: 'Front view' },
        { url: 'https://example.com/back.png' },
      ]),
    ).toEqual([
      { url: 'http://example.com/front.png', alt: 'Front view' },
      { url: 'https://example.com/back.png', alt: '' },
    ]);
  });

  it('detects duplicates after canonicalizing host, protocol and default port', () => {
    expect(() =>
      normalizeProductImages([
        { url: 'HTTP://EXAMPLE.COM:80/front.png' },
        { url: 'http://example.com/front.png' },
      ]),
    ).toThrow(CatalogValidationError);
  });

  it.each([
    'not-a-url',
    'ftp://example.com/image.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://user@example.com/image.png',
    'https://user:password@example.com/image.png',
  ])('rejects unsupported or credential-bearing image URLs: %s', (url) => {
    expect(() => normalizeProductImages([{ url }])).toThrow(
      CatalogValidationError,
    );
  });

  it('accepts ten images and rejects an eleventh', () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      url: `https://example.com/${index}.png`,
    }));
    expect(normalizeProductImages(images)).toHaveLength(10);
    expect(() =>
      normalizeProductImages([
        ...images,
        { url: 'https://example.com/eleven.png' },
      ]),
    ).toThrow(CatalogValidationError);
  });

  it('limits URLs to 2048 canonical characters and alternative text to 200 Unicode characters', () => {
    const prefix = 'https://example.com/';
    const url = `${prefix}${'a'.repeat(2048 - prefix.length)}`;
    expect(
      normalizeProductImages([{ url, alt: '🙂'.repeat(200) }])[0].alt,
    ).toBe('🙂'.repeat(200));
    expect(() => normalizeProductImages([{ url: `${url}a` }])).toThrow(
      CatalogValidationError,
    );
    expect(() =>
      normalizeProductImages([{ url, alt: '🙂'.repeat(201) }]),
    ).toThrow(CatalogValidationError);
    expect(() =>
      normalizeProductImages([{ url: `${prefix}${'é'.repeat(400)}` }]),
    ).toThrow(CatalogValidationError);
  });

  it.each([
    null,
    {},
    'image.png',
    [null],
    [{ url: null }],
    [{ url: 'https://example.com/image.png', alt: null }],
  ])('rejects invalid image shapes: %j', (images) => {
    expect(() => normalizeProductImages(images)).toThrow(
      CatalogValidationError,
    );
  });
});
