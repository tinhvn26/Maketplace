import {
  InsufficientStockError,
  InventoryValidationError,
} from '../errors/inventory.errors.js';
import {
  MAX_STOCK_QUANTITY,
  inventoryDate,
  inventoryId,
  positiveQuantity,
} from '../policies/inventory-input.policy.js';

/** Invariant: 0 <= reserved <= onHand <= MAX_STOCK_QUANTITY. */
export interface Stock {
  id: string;
  warehouseId: string;
  variantId: string;
  onHand: number;
  reserved: number;
  version: number;
  updatedAt: Date;
}

export function availableQuantity(stock: Pick<Stock, 'onHand' | 'reserved'>) {
  return stock.onHand - stock.reserved;
}

export function createStock(input: {
  id: string;
  warehouseId: string;
  variantId: string;
  now: Date;
}): Stock {
  return {
    id: inventoryId(input.id, 'stock identifier'),
    warehouseId: inventoryId(input.warehouseId, 'warehouse identifier'),
    variantId: inventoryId(input.variantId, 'variant identifier'),
    onHand: 0,
    reserved: 0,
    version: 0,
    updatedAt: inventoryDate(input.now),
  };
}

function next(stock: Stock, onHand: number, reserved: number, now: Date): Stock {
  if (onHand > MAX_STOCK_QUANTITY)
    throw new InventoryValidationError(
      `Stock on hand cannot exceed ${MAX_STOCK_QUANTITY}`,
    );
  if (reserved < 0 || onHand < reserved)
    throw new InsufficientStockError(
      'On-hand stock cannot fall below the reserved quantity',
    );
  return { ...stock, onHand, reserved, updatedAt: inventoryDate(now) };
}

export function receiveStock(stock: Stock, quantity: number, now: Date) {
  return next(stock, stock.onHand + positiveQuantity(quantity), stock.reserved, now);
}

export function adjustStock(stock: Stock, delta: number, now: Date) {
  if (
    !Number.isSafeInteger(delta) ||
    delta === 0 ||
    Math.abs(delta) > MAX_STOCK_QUANTITY
  )
    throw new InventoryValidationError(
      'Adjustment must be a nonzero integer quantity',
    );
  return next(stock, stock.onHand + delta, stock.reserved, now);
}

export function reserveStock(stock: Stock, quantity: number, now: Date) {
  if (availableQuantity(stock) < positiveQuantity(quantity))
    throw new InsufficientStockError();
  return next(stock, stock.onHand, stock.reserved + quantity, now);
}

export function releaseStock(stock: Stock, quantity: number, now: Date) {
  return next(stock, stock.onHand, stock.reserved - positiveQuantity(quantity), now);
}

/** Shipping consumes reserved units: both on-hand and reserved decrease. */
export function shipStock(stock: Stock, quantity: number, now: Date) {
  positiveQuantity(quantity);
  return next(stock, stock.onHand - quantity, stock.reserved - quantity, now);
}
