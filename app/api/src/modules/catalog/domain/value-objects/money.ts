import { CatalogValidationError } from '../errors/catalog.errors.js';

export class Money {
  readonly currency = 'VND' as const;

  private constructor(readonly amount: number) {
    Object.freeze(this);
  }

  static vnd(amount: number): Money {
    if (!Number.isInteger(amount) || amount < 0 || amount > 2_147_483_647) {
      throw new CatalogValidationError(
        'VND price must be an integer between 0 and 2147483647',
      );
    }
    return new Money(amount);
  }
}
