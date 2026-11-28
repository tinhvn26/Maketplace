import type { OrderStatus, ShippingAddress } from '../entities/order.js';
import { OrderValidationError } from '../errors/order.errors.js';

export interface CheckoutLineInput {
  variantId: string;
  quantity: number;
  expectedUnitPriceAmount?: number;
}

const STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

function fail(message: string): never {
  throw new OrderValidationError(message);
}

function text(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string') return fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max)
    return fail(`${field} must be ${min}-${max} characters`);
  return trimmed;
}

function int(value: unknown, field: string, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    return fail(`${field} must be an integer between ${min} and ${max}`);
  return value;
}

export function checkoutLines(value: unknown): CheckoutLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    return fail('lines must contain 1-100 items');
  const seen = new Set<string>();
  return value.map((raw: unknown) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const variantId = text(item.variantId, 'variantId', 1, 100);
    if (seen.has(variantId)) return fail('variantId must not repeat');
    seen.add(variantId);
    const line: CheckoutLineInput = {
      variantId,
      quantity: int(item.quantity, 'quantity', 1, 999),
    };
    if (item.expectedUnitPriceAmount !== undefined)
      line.expectedUnitPriceAmount = int(
        item.expectedUnitPriceAmount,
        'expectedUnitPriceAmount',
        0,
        Number.MAX_SAFE_INTEGER,
      );
    return line;
  });
}

export function shippingAddress(value: unknown): ShippingAddress {
  const raw = (value ?? {}) as Record<string, unknown>;
  const phoneNumber = text(raw.phoneNumber, 'phoneNumber', 1, 100);
  if (!/^\+?[0-9]{7,15}$/.test(phoneNumber))
    return fail('phoneNumber is invalid');
  return {
    recipientName: text(raw.recipientName, 'recipientName', 1, 100),
    phoneNumber,
    addressLine: text(raw.addressLine, 'addressLine', 5, 300),
  };
}

export function orderNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return text(value, 'note', 0, 500) || null;
}

export function cancelReason(value: unknown, required: boolean) {
  const reason = text(value ?? '', 'reason', required ? 1 : 0, 200);
  return reason || null;
}

export function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value))
    return fail('idempotencyKey must be 8-100 characters of A-Z a-z 0-9 _ -');
  return value;
}

export function orderId(value: unknown): string {
  return text(value, 'orderId', 1, Number.MAX_SAFE_INTEGER);
}

export function orderVersion(value: unknown): number {
  return int(value, 'version', 0, 2147483646);
}

export function orderPaging(page: unknown, limit: unknown) {
  return {
    page:
      page === undefined ? 1 : int(page, 'page', 1, Number.MAX_SAFE_INTEGER),
    limit: limit === undefined ? 20 : int(limit, 'limit', 1, 100),
  };
}

export function orderStatus(value: unknown): OrderStatus {
  if (!STATUSES.includes(value as OrderStatus))
    return fail('status is invalid');
  return value as OrderStatus;
}
