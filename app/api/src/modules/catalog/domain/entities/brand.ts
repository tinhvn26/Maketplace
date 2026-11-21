import { CatalogValidationError } from '../errors/catalog.errors.js';
import {
  catalogDate,
  catalogId,
  catalogName,
  catalogSlug,
} from '../policies/catalog-input.policy.js';

export interface Brand {
  id: string;
  name: string;
  slug: string;
  version: number;
  createdAt: Date;
}

export function createBrand(input: {
  id: string;
  name: string;
  slug: string;
  now: Date;
}): Brand {
  return {
    id: catalogId(input.id),
    name: catalogName(input.name, 100),
    slug: catalogSlug(input.slug),
    version: 0,
    createdAt: catalogDate(input.now),
  };
}

export function updateBrand(
  brand: Brand,
  input: { name?: string; slug?: string },
): Brand {
  if (
    typeof input !== 'object' ||
    input === null ||
    (input.name === undefined && input.slug === undefined)
  )
    throw new CatalogValidationError('Provide a brand detail to update');
  return {
    ...createBrand({
      id: brand.id,
      name: input.name === undefined ? brand.name : input.name,
      slug: input.slug === undefined ? brand.slug : input.slug,
      now: brand.createdAt,
    }),
    version: brand.version,
  };
}
