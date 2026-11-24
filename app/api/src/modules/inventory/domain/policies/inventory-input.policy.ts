import { InventoryValidationError } from '../errors/inventory.errors.js';

export const MAX_STOCK_QUANTITY = 1_000_000_000;

export function inventoryId(value: unknown, label = 'identifier'): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100)
    throw new InventoryValidationError(`A valid ${label} is required`);
  return value.trim();
}

export function positiveQuantity(value: unknown, max = MAX_STOCK_QUANTITY) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > max
  )
    throw new InventoryValidationError(
      `Quantity must be an integer from 1 to ${max}`,
    );
  return value as number;
}

export function movementReason(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value.trim()).length > 200
  )
    throw new InventoryValidationError(
      'Reason must contain 1 to 200 characters',
    );
  return value.trim();
}

export function inventoryVersion(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 2_147_483_646
  )
    throw new InventoryValidationError('Version must be a nonnegative integer');
  return value as number;
}

export function inventoryDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new InventoryValidationError('A valid timestamp is required');
  return new Date(value.getTime());
}
