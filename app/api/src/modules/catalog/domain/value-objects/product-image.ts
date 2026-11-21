import { CatalogValidationError } from '../errors/catalog.errors.js';
import { CATALOG_LIMITS } from '../policies/catalog-input.policy.js';

export interface ProductImage {
  url: string;
  alt: string;
  assetId?: string;
  thumbnailUrl?: string;
}

export interface ProductImageInput {
  url: string;
  alt?: string;
  assetId?: string;
  thumbnailUrl?: string;
}

export function normalizeProductImages(value: unknown): ProductImage[] {
  if (!Array.isArray(value) || value.length > CATALOG_LIMITS.images) {
    throw new CatalogValidationError('Products may contain at most 10 images');
  }
  const urls = new Set<string>();
  return value.map((image: unknown) => {
    if (typeof image !== 'object' || image === null || Array.isArray(image)) {
      throw new CatalogValidationError('A product image must be an object');
    }
    const input = image as Record<string, unknown>;
    if (
      typeof input.url !== 'string' ||
      input.url.trim().length > CATALOG_LIMITS.imageUrl
    ) {
      throw new CatalogValidationError(
        'Image URL must contain at most 2048 characters',
      );
    }
    let url: URL;
    try {
      url = new URL(input.url.trim());
    } catch {
      throw new CatalogValidationError(
        'Image URL must be an HTTP or HTTPS URL',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.href.length > CATALOG_LIMITS.imageUrl
    ) {
      throw new CatalogValidationError(
        'Image URL must be HTTP or HTTPS without credentials and at most 2048 characters',
      );
    }
    if (urls.has(url.href)) {
      throw new CatalogValidationError('Product image URLs must be unique');
    }
    urls.add(url.href);
    const alt = input.alt === undefined ? '' : input.alt;
    if (
      typeof alt !== 'string' ||
      Array.from(alt).length > CATALOG_LIMITS.imageAlt
    ) {
      throw new CatalogValidationError(
        'Image alternative text must contain at most 200 characters',
      );
    }
    if (
      input.assetId !== undefined &&
      (typeof input.assetId !== 'string' ||
        !input.assetId.trim() ||
        input.assetId.length > 100)
    ) {
      throw new CatalogValidationError(
        'Image asset ID must be a nonempty identifier',
      );
    }
    if (input.thumbnailUrl !== undefined) {
      if (typeof input.thumbnailUrl !== 'string')
        throw new CatalogValidationError('Invalid thumbnail URL');
      let thumbnail: URL;
      try {
        thumbnail = new URL(String(input.thumbnailUrl));
      } catch {
        throw new CatalogValidationError('Invalid thumbnail URL');
      }
      if (
        !['http:', 'https:'].includes(thumbnail.protocol) ||
        thumbnail.username ||
        thumbnail.password ||
        thumbnail.href.length > 2048
      ) {
        throw new CatalogValidationError('Invalid thumbnail URL');
      }
    }
    return {
      url: url.href,
      alt,
      ...(input.assetId === undefined ? {} : { assetId: input.assetId.trim() }),
      ...(input.thumbnailUrl === undefined
        ? {}
        : { thumbnailUrl: String(input.thumbnailUrl) }),
    };
  });
}
