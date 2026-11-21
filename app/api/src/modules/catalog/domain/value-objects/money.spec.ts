import { describe, expect, it } from 'vitest';
import { CatalogValidationError } from '../errors/catalog.errors.js';
import { Money } from './money.js';

describe('Money', () => {
  it.each([0, 1, 2_147_483_647])(
    'represents %i VND as integer units',
    (amount) => {
      const money = Money.vnd(amount);
      expect(money.amount).toBe(amount);
      expect(money.currency).toBe('VND');
    },
  );

  it.each([-1, 0.5, 2_147_483_648, Number.MAX_SAFE_INTEGER, NaN, Infinity])(
    'rejects invalid or unpersistable amounts: %s',
    (amount) => {
      expect(() => Money.vnd(amount)).toThrow(CatalogValidationError);
    },
  );

  it('cannot be mutated into an invalid amount after construction', () => {
    const money = Money.vnd(100_000);
    expect(() => Object.assign(money, { amount: -1 })).toThrow(TypeError);
    expect(money.amount).toBe(100_000);
  });
});
