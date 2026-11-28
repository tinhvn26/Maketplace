import { describe, expect, it } from 'vitest';
import { OrderValidationError } from '../errors/order.errors.js';
import {
  cancelReason,
  checkoutLines,
  idempotencyKey,
  orderNote,
  orderPaging,
  shippingAddress,
} from './order-input.policy.js';

const bad = (fn: () => unknown) => expect(fn).toThrow(OrderValidationError);

describe('order input policy', () => {
  it('validates checkout lines', () => {
    expect(checkoutLines([{ variantId: 'a', quantity: 1 }])).toHaveLength(1);
    bad(() => checkoutLines([]));
    bad(() =>
      checkoutLines(
        Array.from({ length: 101 }, (_, i) => ({
          variantId: `v${i}`,
          quantity: 1,
        })),
      ),
    );
    bad(() =>
      checkoutLines([
        { variantId: 'a', quantity: 1 },
        { variantId: 'a', quantity: 2 },
      ]),
    );
    for (const quantity of [0, 1000, 1.5])
      bad(() => checkoutLines([{ variantId: 'a', quantity }]));
    bad(() =>
      checkoutLines([
        { variantId: 'a', quantity: 1, expectedUnitPriceAmount: -1 },
      ]),
    );
  });

  it('validates and trims the shipping address', () => {
    const ok = {
      recipientName: '  An  ',
      phoneNumber: '0912345678',
      addressLine: '1 Le Loi',
    };
    expect(shippingAddress(ok).recipientName).toBe('An');
    bad(() => shippingAddress({ ...ok, phoneNumber: '12ab' }));
    bad(() => shippingAddress({ ...ok, addressLine: 'abc' }));
  });

  it('normalises the note', () => {
    expect(orderNote('   ')).toBeNull();
    bad(() => orderNote('x'.repeat(501)));
  });

  it('requires a cancel reason only when asked', () => {
    bad(() => cancelReason('', true));
    expect(cancelReason(undefined, false)).toBeNull();
  });

  it('validates the idempotency key', () => {
    bad(() => idempotencyKey('short'));
    expect(idempotencyKey('abc_DEF-123')).toBe('abc_DEF-123');
  });

  it('validates paging', () => {
    expect(orderPaging(undefined, undefined)).toEqual({ page: 1, limit: 20 });
    bad(() => orderPaging(undefined, 101));
  });
});
