export const CATALOG_PURCHASING_READER = Symbol('CATALOG_PURCHASING_READER');

export interface PurchasableVariant {
  variantId: string;
  productId: string;
  shopId: string | null;
  productName: string;
  variantName: string;
  sku: string;
  unitPriceAmount: number;
  currency: 'VND';
  productVersion: number;
}

export interface CatalogPurchasingReader {
  findPurchasableVariants(
    ids: readonly string[],
  ): Promise<PurchasableVariant[]>;
}
