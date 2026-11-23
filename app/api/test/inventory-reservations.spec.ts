import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryReservationService } from '../src/modules/inventory/application/reservations/inventory-reservation.service.js';
import {
  IdempotencyConflictError,
  InsufficientStockError,
  InventoryNotFoundError,
  InventoryVersionConflictError,
  ReservationStateError,
} from '../src/modules/inventory/domain/errors/inventory.errors.js';
import { InMemoryInventory } from './support/in-memory-inventory.js';

const start = new Date('2026-11-22T00:00:00.000Z');

describe('InventoryReservationService', () => {
  let store: InMemoryInventory;
  let now: Date;
  let sequence: number;
  let quote: ReturnType<typeof vi.fn>;
  let service: InventoryReservationService;

  const stockOf = (warehouseId: string) =>
    [...store.stocks.values()].find((s) => s.warehouseId === warehouseId)!;

  beforeEach(() => {
    now = new Date(start);
    sequence = 0;
    store = new InMemoryInventory();
    for (const [id, priority] of [['wa', 1], ['wb', 2]] as const)
      store.warehouses.set(id, {
        id,
        shopId: 's1',
        name: id,
        code: id.toUpperCase(),
        priority,
        isActive: true,
        version: 0,
        createdAt: start,
        updatedAt: start,
      });
    for (const [warehouseId, onHand] of [['wa', 5], ['wb', 4]] as const)
      store.stocks.set(`stock-${warehouseId}`, {
        id: `stock-${warehouseId}`,
        warehouseId,
        variantId: 'v1',
        onHand,
        reserved: 0,
        version: 0,
        updatedAt: start,
      });
    quote = vi.fn(async () => ({}));
    service = new InventoryReservationService(
      store,
      { quote } as never,
      { ttlSeconds: 900 },
      { next: () => `id-${++sequence}` },
      { now: () => now },
    );
  });

  const reserve = (quantity = 7, key = 'order-1') =>
    service.reserve({
      idempotencyKey: key,
      reference: key,
      lines: [{ variantId: 'v1', quantity }],
    });

  it('splits one line across warehouses by priority and records the holds', async () => {
    const result = await reserve(7);
    expect(result).toMatchObject({
      status: 'ACTIVE',
      expiresAt: new Date(start.getTime() + 900_000),
    });
    expect(result.allocations).toEqual([
      { variantId: 'v1', warehouseId: 'wa', quantity: 5, shipped: false },
      { variantId: 'v1', warehouseId: 'wb', quantity: 2, shipped: false },
    ]);
    expect(stockOf('wa')).toMatchObject({ onHand: 5, reserved: 5 });
    expect(stockOf('wb')).toMatchObject({ onHand: 4, reserved: 2 });
    expect(store.movements.filter((m) => m.type === 'RESERVE')).toHaveLength(2);
  });

  it('answers a repeated key with the original reservation and rejects a different request', async () => {
    const first = await reserve(3);
    expect(await reserve(3)).toEqual(first);
    expect(store.reservations.size).toBe(1);
    expect(stockOf('wa').reserved).toBe(3);
    expect(quote).toHaveBeenCalledTimes(1);
    await expect(reserve(4)).rejects.toThrow(IdempotencyConflictError);
  });

  it('allocates everything or nothing', async () => {
    await expect(reserve(10)).rejects.toThrow(InsufficientStockError);
    expect(store.reservations.size).toBe(0);
    expect(stockOf('wa').reserved + stockOf('wb').reserved).toBe(0);
    expect(store.movements).toHaveLength(0);
  });

  it('does not reserve variants the catalog refuses to sell', async () => {
    quote.mockRejectedValueOnce(new Error('not purchasable'));
    await expect(reserve(1)).rejects.toThrow('not purchasable');
    expect(store.reservations.size).toBe(0);
  });

  it('skips inactive warehouses', async () => {
    store.warehouses.set('wa', { ...store.warehouses.get('wa')!, isActive: false });
    expect((await reserve(2)).allocations.map((a) => a.warehouseId)).toEqual(['wb']);
    await expect(reserve(3, 'order-2')).rejects.toThrow(InsufficientStockError);
  });

  it('confirms once, keeps confirming idempotent, and refuses after expiry', async () => {
    const { reservationId } = await reserve(2);
    expect(await service.confirm(reservationId)).toMatchObject({
      status: 'ALLOCATED',
      expiresAt: null,
    });
    expect((await service.confirm(reservationId)).status).toBe('ALLOCATED');

    const late = await reserve(1, 'order-2');
    now = new Date(start.getTime() + 901_000);
    await expect(service.confirm(late.reservationId)).rejects.toThrow(
      ReservationStateError,
    );
  });

  it('ships per warehouse and finishes when every warehouse shipped', async () => {
    const { reservationId } = await reserve(7);
    await expect(service.ship(reservationId, 'wa')).rejects.toThrow(
      ReservationStateError,
    );
    await service.confirm(reservationId);

    const partial = await service.ship(reservationId, 'wa');
    expect(partial.status).toBe('ALLOCATED');
    expect(stockOf('wa')).toMatchObject({ onHand: 0, reserved: 0 });
    expect(stockOf('wb')).toMatchObject({ onHand: 4, reserved: 2 });
    await expect(service.ship(reservationId, 'wa')).rejects.toThrow(
      ReservationStateError,
    );

    expect((await service.ship(reservationId, 'wb')).status).toBe('SHIPPED');
    expect(stockOf('wb')).toMatchObject({ onHand: 2, reserved: 0 });
    expect(store.movements.filter((m) => m.type === 'SHIP')).toHaveLength(2);
  });

  it('releases only the unshipped part and repeats safely', async () => {
    const { reservationId } = await reserve(7);
    await service.confirm(reservationId);
    await service.ship(reservationId, 'wa');

    expect((await service.release(reservationId)).status).toBe('RELEASED');
    expect(stockOf('wa')).toMatchObject({ onHand: 0, reserved: 0 });
    expect(stockOf('wb')).toMatchObject({ onHand: 4, reserved: 0 });
    const movements = store.movements.length;
    expect((await service.release(reservationId)).status).toBe('RELEASED');
    expect(store.movements).toHaveLength(movements);
  });

  it('cannot release a shipped reservation or find an unknown one', async () => {
    const { reservationId } = await reserve(2);
    await service.confirm(reservationId);
    await service.ship(reservationId, 'wa');
    await expect(service.release(reservationId)).rejects.toThrow(ReservationStateError);
    await expect(service.confirm('missing')).rejects.toThrow(InventoryNotFoundError);
  });

  it('expires unconfirmed holds past their TTL and leaves confirmed ones', async () => {
    const stale = await reserve(3, 'order-1');
    const confirmed = await reserve(1, 'order-2');
    await service.confirm(confirmed.reservationId);

    expect(await service.expireDue()).toBe(0);
    now = new Date(start.getTime() + 901_000);
    expect(await service.expireDue()).toBe(1);

    expect(store.reservations.get(stale.reservationId)!.status).toBe('EXPIRED');
    expect(store.reservations.get(confirmed.reservationId)!.status).toBe('ALLOCATED');
    expect(stockOf('wa').reserved).toBe(1);
    expect(store.movements.filter((m) => m.type === 'EXPIRE')).toHaveLength(1);
    expect(await service.expireDue()).toBe(0);
  });

  it('retries a lost compare-and-set and then succeeds', async () => {
    let interfered = false;
    store.beforeStockSave = () => {
      if (interfered) return;
      interfered = true;
      store.stocks.set('stock-wa', { ...stockOf('wa'), version: 7 });
    };
    expect((await reserve(2)).status).toBe('ACTIVE');
    expect(store.reservations.size).toBe(1);
  });

  it('gives up after repeated conflicts without leaving partial holds', async () => {
    store.beforeStockSave = () =>
      store.stocks.set('stock-wa', { ...stockOf('wa'), version: stockOf('wa').version + 1 });
    await expect(reserve(2)).rejects.toThrow(InventoryVersionConflictError);
    expect(store.reservations.size).toBe(0);
    expect(store.movements).toHaveLength(0);
  });

  it('rejects malformed requests before touching stock', async () => {
    for (const lines of [
      [],
      [{ variantId: 'v1', quantity: 0 }],
      [{ variantId: 'v1', quantity: 1000 }],
      [
        { variantId: 'v1', quantity: 1 },
        { variantId: 'v1', quantity: 1 },
      ],
    ])
      await expect(
        service.reserve({ idempotencyKey: 'k', reference: 'r', lines }),
      ).rejects.toThrow();
    expect(quote).not.toHaveBeenCalled();
  });
});
