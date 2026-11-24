import type {
  CatalogPricing,
  CatalogQuoteRequest,
} from '../../contracts/catalog-pricing.api.js';
import type { CatalogPurchasingReader } from '../ports/catalog-purchasing.reader.js';
import type { CatalogClock } from '../ports/catalog-runtime.js';
import {
  CatalogConflictError,
  CatalogNotFoundError,
  CatalogValidationError,
} from '../../domain/errors/catalog.errors.js';

export class CatalogQuoteService implements CatalogPricing {
  constructor(
    private readonly reader: CatalogPurchasingReader,
    private readonly clock: CatalogClock,
  ) {}

  async quote(input: CatalogQuoteRequest) {
    if (
      !input ||
      !Array.isArray(input.lines) ||
      input.lines.length < 1 ||
      input.lines.length > 100
    )
      throw new CatalogValidationError(
        'Quote requires 1 to 100 unique variants',
      );
    const ids = new Set<string>();
    for (const line of input.lines) {
      if (
        !line ||
        typeof line.variantId !== 'string' ||
        !line.variantId.trim() ||
        line.variantId !== line.variantId.trim() ||
        ids.has(line.variantId) ||
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 999
      )
        throw new CatalogValidationError(
          'Invalid quote item or duplicate variant',
        );
      for (const value of [
        line.expectedProductVersion,
        line.expectedUnitPriceAmount,
      ]) {
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
        )
          throw new CatalogValidationError(
            'Invalid expected price or product version',
          );
      }
      ids.add(line.variantId);
    }

    const records = await this.reader.findPurchasableVariants([...ids]);
    const byId = new Map(records.map((record) => [record.variantId, record]));

    const lines = input.lines.map((line) => {
      const record = byId.get(line.variantId);
      if (!record)
        throw new CatalogNotFoundError(
          'A requested variant is not available for purchase',
        );
      if (
        (line.expectedProductVersion !== undefined &&
          line.expectedProductVersion !== record.productVersion) ||
        (line.expectedUnitPriceAmount !== undefined &&
          line.expectedUnitPriceAmount !== record.unitPriceAmount)
      )
        throw new CatalogConflictError(
          'Catalog price or product changed; refresh the quote',
        );
      return {
        ...record,
        quantity: line.quantity,
        lineTotalAmount: record.unitPriceAmount * line.quantity,
      };
    });

    const totalAmount = lines.reduce(
      (sum, line) => sum + line.lineTotalAmount,
      0,
    );

    if (!Number.isSafeInteger(totalAmount))
      throw new CatalogValidationError('Quote total is too large');

    return {
      lines,
      totalAmount,
      currency: 'VND' as const,
      quotedAt: this.clock.now(),
    };
  }
}
