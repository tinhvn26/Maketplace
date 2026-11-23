import { InventoryValidationError } from '../../domain/errors/inventory.errors.js';
import { availableQuantity } from '../../domain/entities/stock.js';
import type { Stock } from '../../domain/entities/stock.js';
import type { Warehouse } from '../../domain/entities/warehouse.js';

export interface InventoryPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface StockResult {
  id: string;
  warehouseId: string;
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  updatedAt: Date;
}

export type WarehouseResult = Warehouse;

export function toStockResult(stock: Stock): StockResult {
  return { ...stock, available: availableQuantity(stock) };
}

export function normalizePaging(page: number, limit: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (page - 1) * limit > 2_147_483_647
  )
    throw new InventoryValidationError('Invalid pagination');
  return { page, limit };
}

export function toPage<T>(
  result: { items: T[]; total: number },
  page: number,
  limit: number,
): InventoryPage<T> {
  return {
    items: result.items,
    total: result.total,
    page,
    limit,
    pages: Math.ceil(result.total / limit),
  };
}
