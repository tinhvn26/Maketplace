import {
  InventoryNotFoundError,
  InventoryVersionConflictError,
} from '../../domain/errors/inventory.errors.js';

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

export function prismaErrorCode(error: unknown): unknown {
  return record(error)?.code;
}

export function isSqliteBusy(error: unknown): boolean {
  const cause = record(record(record(error)?.meta)?.driverAdapterError)?.cause;
  const code = record(cause)?.originalCode;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}

/**
 * Maps storage failures to inventory errors. A lost race (busy database or a
 * concurrent insert of the same key) is retryable; the caller decides what a
 * unique violation means through `onUnique`.
 */
export function translateStorageError(
  error: unknown,
  onUnique: () => Error = () => new InventoryVersionConflictError(),
): never {
  if (isSqliteBusy(error))
    throw new InventoryVersionConflictError('Inventory storage is busy');
  const code = prismaErrorCode(error);
  if (code === 'P2002') throw onUnique();
  if (code === 'P2003')
    throw new InventoryNotFoundError(
      'A referenced shop, warehouse or variant no longer exists',
    );
  throw error;
}
