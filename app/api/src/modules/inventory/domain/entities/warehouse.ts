import { InventoryValidationError } from '../errors/inventory.errors.js';
import { inventoryDate, inventoryId } from '../policies/inventory-input.policy.js';

export interface Warehouse {
  id: string;
  /** null = platform warehouse, managed by administrators. */
  shopId: string | null;
  name: string;
  code: string;
  /** Lower value is allocated first. */
  priority: number;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value.trim()).length > 100
  )
    throw new InventoryValidationError(
      'Warehouse name must contain 1 to 100 characters',
    );
  return value.trim();
}

function code(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized))
    throw new InventoryValidationError(
      'Warehouse code must be 1 to 32 letters, digits, hyphens or underscores',
    );
  return normalized;
}

function priority(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1000)
    throw new InventoryValidationError(
      'Warehouse priority must be an integer from 0 to 1000',
    );
  return value as number;
}

export function createWarehouse(input: {
  id: string;
  shopId: string | null;
  name: string;
  code: string;
  priority?: number;
  now: Date;
}): Warehouse {
  return {
    id: inventoryId(input.id, 'warehouse identifier'),
    shopId: input.shopId === null ? null : inventoryId(input.shopId, 'shop identifier'),
    name: name(input.name),
    code: code(input.code),
    priority: priority(input.priority ?? 100),
    isActive: true,
    version: 0,
    createdAt: inventoryDate(input.now),
    updatedAt: inventoryDate(input.now),
  };
}

export function updateWarehouse(
  warehouse: Warehouse,
  changes: { name?: string; priority?: number; isActive?: boolean },
  now: Date,
): Warehouse {
  if (
    typeof changes !== 'object' ||
    changes === null ||
    (changes.name === undefined &&
      changes.priority === undefined &&
      changes.isActive === undefined)
  )
    throw new InventoryValidationError(
      'Provide at least one warehouse detail to update',
    );
  if (changes.isActive !== undefined && typeof changes.isActive !== 'boolean')
    throw new InventoryValidationError('isActive must be a boolean');
  return {
    ...warehouse,
    name: changes.name === undefined ? warehouse.name : name(changes.name),
    priority:
      changes.priority === undefined ? warehouse.priority : priority(changes.priority),
    isActive: changes.isActive ?? warehouse.isActive,
    updatedAt: inventoryDate(now),
  };
}
