import {
  CATALOG_LIMITS,
  catalogDate,
  catalogId,
  catalogName,
  catalogSlug,
} from '../policies/catalog-input.policy.js';
import { CatalogValidationError } from '../errors/catalog.errors.js';
import { CatalogConflictError } from '../errors/catalog.errors.js';
import {
  normalizeCategoryAttributeDefinitions,
  type CategoryAttributeDefinition,
} from '../policies/category-attributes.policy.js';

export interface Category {
  id: string;
  name: string;
  slug: string;
  version: number;
  createdAt: Date;
  parentId?: string | null;
  attributeDefinitions?: CategoryAttributeDefinition[];
}

export function createCategory(input: {
  id: string;
  name: string;
  slug: string;
  now: Date;
  parentId?: string | null;
  attributeDefinitions?: CategoryAttributeDefinition[];
}): Category {
  const id = catalogId(input.id);
  const parentId =
    input.parentId === null || input.parentId === undefined
      ? null
      : catalogId(input.parentId);
  if (parentId === id)
    throw new CatalogConflictError('A category cannot be its own parent');
  return {
    id,
    name: catalogName(input.name, CATALOG_LIMITS.categoryName),
    slug: catalogSlug(input.slug),
    version: 0,
    createdAt: catalogDate(input.now),
    parentId,
    attributeDefinitions: normalizeCategoryAttributeDefinitions(
      input.attributeDefinitions ?? [],
    ),
  };
}

export function updateCategory(
  category: Category,
  changes: {
    name?: string;
    slug?: string;
    parentId?: string | null;
    attributeDefinitions?: CategoryAttributeDefinition[];
  },
): Category {
  if (
    typeof changes !== 'object' ||
    changes === null ||
    (changes.name === undefined &&
      changes.slug === undefined &&
      changes.parentId === undefined &&
      changes.attributeDefinitions === undefined)
  ) {
    throw new CatalogValidationError(
      'Provide at least one category detail to update',
    );
  }
  if (!Number.isSafeInteger(category.version) || category.version < 0) {
    throw new CatalogValidationError(
      'Category version must be a nonnegative integer',
    );
  }
  return {
    ...createCategory({
      id: category.id,
      name: changes.name === undefined ? category.name : changes.name,
      slug: changes.slug === undefined ? category.slug : changes.slug,
      now: category.createdAt,
      parentId:
        changes.parentId === undefined ? category.parentId : changes.parentId,
      attributeDefinitions:
        changes.attributeDefinitions === undefined
          ? category.attributeDefinitions
          : changes.attributeDefinitions,
    }),
    version: category.version,
  };
}
