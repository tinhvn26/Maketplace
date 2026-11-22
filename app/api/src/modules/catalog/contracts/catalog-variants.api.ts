export const CATALOG_VARIANTS = Symbol('CATALOG_VARIANTS');

export interface CatalogVariantOwner {
  variantId: string;
  /** null = platform product. */
  shopId: string | null;
}

/** Ownership lookup for any variant, including draft or inactive ones. */
export interface CatalogVariants {
  findVariantShops(ids: readonly string[]): Promise<CatalogVariantOwner[]>;
}
