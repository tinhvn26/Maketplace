import {
  CatalogNotFoundError,
  CatalogValidationError,
} from '../../domain/errors/catalog.errors.js';
import { normalizeProductQuery } from '../shared/catalog-query.policy.js';
import {
  toPublicCategory,
  toPublicProduct,
  toPublicProductSummary,
} from './catalog.result.js';
import type { PublicProductResult } from './catalog.result.js';
import type { CatalogPage } from '../shared/catalog-page.js';
import type {
  ProductListQuery,
  PublicCatalogReader,
  ProductSummary,
  CatalogBrowseQuery,
} from '../ports/catalog.repository.js';
import { normalizeCatalogBrowseQuery } from './catalog-cursor.js';

export class CatalogQueryService {
  constructor(private readonly catalog: PublicCatalogReader) {}

  async listCategories() {
    return (await this.catalog.listCategories()).map(toPublicCategory);
  }

  async listProducts(
    query: ProductListQuery,
  ): Promise<CatalogPage<ProductSummary>> {
    const normalized = normalizeProductQuery(query);
    const result = await this.catalog.listPublishedProducts(normalized);
    return {
      items: result.items.map(toPublicProductSummary),
      total: result.total,
      page: normalized.page,
      limit: normalized.limit,
      pages: Math.ceil(result.total / normalized.limit),
    };
  }

  async browseProducts(query: CatalogBrowseQuery) {
    const result = await this.catalog.browsePublishedProducts(
      normalizeCatalogBrowseQuery(query),
    );
    return { ...result, items: result.items.map(toPublicProductSummary) };
  }

  async listCategoryTree() {
    const categories = (await this.catalog.listCategories()).map(
      toPublicCategory,
    );
    type Node = (typeof categories)[number] & { children: Node[] };
    const nodes = new Map<string, Node>(
      categories.map((category) => [
        category.id,
        { ...category, children: [] },
      ]),
    );
    const roots: Node[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async getProduct(slug: string): Promise<PublicProductResult> {
    if (typeof slug !== 'string' || !slug.trim() || slug.length > 180) {
      throw new CatalogValidationError('Invalid product slug');
    }
    const product = await this.catalog.findPublishedProductBySlug(
      slug.trim().toLowerCase(),
    );
    if (!product || product.status !== 'PUBLISHED') {
      throw new CatalogNotFoundError('Product not found');
    }
    return toPublicProduct(product);
  }
}
