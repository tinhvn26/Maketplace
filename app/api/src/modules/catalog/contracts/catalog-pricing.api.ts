export const CATALOG_PRICING = Symbol('CATALOG_PRICING');

export interface CatalogQuoteRequest {
  lines: Array<{
    variantId: string;
    quantity: number;
    expectedProductVersion?: number;
    expectedUnitPriceAmount?: number;
  }>;
}

export interface CatalogQuoteLine {
  variantId: string;
  productId: string;
  shopId: string | null;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  unitPriceAmount: number;
  lineTotalAmount: number;
  currency: 'VND';
  productVersion: number;
}

export interface CatalogPricing {
  quote(input: CatalogQuoteRequest): Promise<{
    lines: CatalogQuoteLine[];
    totalAmount: number;
    currency: 'VND';
    quotedAt: Date;
  }>;
}
