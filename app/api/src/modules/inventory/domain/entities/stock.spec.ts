import { describe, expect, it } from 'vitest';
import {
  InsufficientStockError,
  InventoryValidationError,
} from '../errors/inventory.errors.js';
import {
  adjustStock,
  availableQuantity,
  createStock,
  receiveStock,
  releaseStock,
  reserveStock,
  shipStock,
} from './stock.js';

const now = new Date('2026-11-22T00:00:00.000Z');
const empty = createStock({ id: 's1', warehouseId: 'w1', variantId: 'v1', now });

describe('Stock', () => {
  it('reserves, releases and ships while keeping reserved within on-hand', () => {
    let stock = receiveStock(empty, 10, now);
    stock = reserveStock(stock, 7, now);
    expect(availableQuantity(stock)).toBe(3);
    stock = shipStock(stock, 4, now);
    expect(stock).toMatchObject({ onHand: 6, reserved: 3 });
    stock = releaseStock(stock, 3, now);
    expect(stock).toMatchObject({ onHand: 6, reserved: 0 });
  });

  it('rejects reserving more than is available', () => {
    const stock = reserveStock(receiveStock(empty, 5, now), 5, now);
    expect(() => reserveStock(stock, 1, now)).toThrow(InsufficientStockError);
  });

  it('never adjusts on-hand below reserved units', () => {
    const stock = reserveStock(receiveStock(empty, 5, now), 3, now);
    expect(adjustStock(stock, -2, now).onHand).toBe(3);
    expect(() => adjustStock(stock, -3, now)).toThrow(InsufficientStockError);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid quantity %s', (quantity) => {
    expect(() => receiveStock(empty, quantity, now)).toThrow(
      InventoryValidationError,
    );
  });

  it('rejects a zero adjustment and releasing units that are not reserved', () => {
    expect(() => adjustStock(empty, 0, now)).toThrow(InventoryValidationError);
    expect(() => releaseStock(receiveStock(empty, 2, now), 1, now)).toThrow(
      InsufficientStockError,
    );
  });
});
