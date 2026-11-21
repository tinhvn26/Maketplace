import type { ProductImageInput } from '../../domain/entities/product.js';
import type { CategoryAttributeDefinition } from '../../domain/policies/category-attributes.policy.js';

export interface CreateCategoryInput {
  name: string;
  slug: string;
  parentId?: string | null;
  attributeDefinitions?: CategoryAttributeDefinition[];
}

export interface UpdateCategoryInput {
  version: number;
  name?: string;
  slug?: string;
  parentId?: string | null;
  attributeDefinitions?: CategoryAttributeDefinition[];
}

export interface CreateProductInput {
  categoryId: string;
  shopId?: string;
  brandId?: string | null;
  name: string;
  slug: string;
  description?: string;
  images?: ProductImageInput[];
}

export interface UpdateProductInput {
  version: number;
  categoryId?: string;
  brandId?: string | null;
  name?: string;
  slug?: string;
  description?: string;
  images?: ProductImageInput[];
}

export interface AddVariantInput {
  version: number;
  sku: string;
  name: string;
  priceAmount: number;
  isActive?: boolean;
  attributes?: Record<string, string>;
  images?: ProductImageInput[];
}

export interface UpdateVariantInput {
  version: number;
  name?: string;
  priceAmount?: number;
  isActive?: boolean;
  attributes?: Record<string, string>;
  images?: ProductImageInput[];
}

export interface ProductVersionInput {
  version: number;
}
