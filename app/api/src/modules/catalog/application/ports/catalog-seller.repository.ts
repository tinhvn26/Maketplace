import type { CatalogAdminRepository } from './catalog.repository.js';

/** Seller workflows do not receive global category/brand administration. */
export type CatalogSellerRepository = Pick<
  CatalogAdminRepository,
  'findCategoryById' | 'listAdminProducts' | 'createProduct' | 'saveProduct'
>;
