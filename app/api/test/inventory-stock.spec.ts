import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShopAccessDeniedError,
  ShopNotFoundError,
  ShopUnavailableError,
} from '../src/modules/shops/contracts/shops.api.js';
import type { ShopAccess } from '../src/modules/shops/contracts/shops.api.js';
import type { InventoryScope } from '../src/modules/inventory/application/shared/inventory-scope.js';
import { InventoryAvailabilityService } from '../src/modules/inventory/application/availability/inventory-availability.service.js';
import { InventoryStockService } from '../src/modules/inventory/application/stock/inventory-stock.service.js';
import { InventoryWarehouseService } from '../src/modules/inventory/application/warehouses/inventory-warehouse.service.js';
import {
  InsufficientStockError,
  InventoryAccessDeniedError,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryStaleVersionError,
  InventoryValidationError,
} from '../src/modules/inventory/domain/errors/inventory.errors.js';
import { InMemoryInventory } from './support/in-memory-inventory.js';

const start = new Date('2026-11-22T00:00:00.000Z');
const seller = { userId: 'u1', role: 'EMPLOYER' as const };
const admin = { userId: 'a1', role: 'ADMIN' as const };
const shop: InventoryScope = { shopId: 's1' };
const platform: InventoryScope = { shopId: null };

describe('Inventory warehouses and stock', () => {
  let store: InMemoryInventory;
  let sequence: number;
  let requireManageable: ReturnType<
    typeof vi.fn<ShopAccess['requireManageable']>
  >;
  let warehouses: InventoryWarehouseService;
  let stock: InventoryStockService;
  let availability: InventoryAvailabilityService;
  // variant -> owning shop (null = platform product)
  const owners: Record<string, string | null> = {
    v1: 's1',
    v2: 's1',
    other: 's2',
    plat: null,
  };

  beforeEach(() => {
    sequence = 0;
    store = new InMemoryInventory();
    store.shops.set('s1', { ownerId: 'u1', sellable: true });
    store.shops.set('s2', { ownerId: 'u1', sellable: true });
    requireManageable = vi.fn<ShopAccess['requireManageable']>(
      async () => undefined,
    );
    const shops = { requireManageable, assertSellable: vi.fn() };
    const ids = { next: () => `id-${++sequence}` };
    const clock = { now: () => start };
    warehouses = new InventoryWarehouseService(store, shops, ids, clock);
    stock = new InventoryStockService(
      store,
      shops,
      {
        findVariantShops: async (variantIds) =>
          variantIds.flatMap((variantId) =>
            variantId in owners
              ? [{ variantId, shopId: owners[variantId] }]
              : [],
          ),
      },
      ids,
      clock,
    );
    availability = new InventoryAvailabilityService(store);
  });

  const warehouse = (code: string, scope = shop, priority = 100) =>
    warehouses.create(
      scope,
      { name: `Kho ${code}`, code, priority },
      scope.shopId === null ? admin : seller,
    );
  const receive = (warehouseId: string, variantId = 'v1', quantity = 10) =>
    stock.receive(
      shop,
      { warehouseId, variantId, quantity, reason: 'Initial' },
      seller,
    );

  describe('warehouses', () => {
    it('creates, lists and updates with optimistic versions', async () => {
      const created = await warehouse('hn');
      expect(created).toMatchObject({
        code: 'HN',
        shopId: 's1',
        isActive: true,
        version: 0,
      });
      expect(requireManageable).toHaveBeenCalledWith('s1', seller);
      expect(await warehouses.list(shop, seller)).toHaveLength(1);

      const updated = await warehouses.update(
        shop,
        created.id,
        { version: 0, isActive: false, priority: 5 },
        seller,
      );
      expect(updated).toMatchObject({
        isActive: false,
        priority: 5,
        version: 1,
      });
      await expect(
        warehouses.update(shop, created.id, { version: 0, name: 'x' }, seller),
      ).rejects.toThrow(InventoryStaleVersionError);
    });

    it('rejects a duplicate code within a shop but allows it in another scope', async () => {
      await warehouse('hn');
      await expect(warehouse('hn')).rejects.toThrow(InventoryConflictError);
      await expect(warehouse('hn', platform)).resolves.toMatchObject({
        shopId: null,
      });
    });

    it('treats another shop warehouse as missing', async () => {
      const mine = await warehouse('hn');
      await expect(
        warehouses.update(
          { shopId: 's2' },
          mine.id,
          { version: 0, name: 'x' },
          seller,
        ),
      ).rejects.toThrow(InventoryNotFoundError);
      expect(await warehouses.list({ shopId: 's2' }, seller)).toEqual([]);
    });

    it('validates input', async () => {
      await expect(warehouse('')).rejects.toThrow(InventoryValidationError);
      await expect(warehouse('bad code!')).rejects.toThrow(
        InventoryValidationError,
      );
      await expect(
        warehouses.create(
          shop,
          { name: 'x', code: 'A', priority: 5000 },
          seller,
        ),
      ).rejects.toThrow(InventoryValidationError);
    });

    it('restricts the platform scope to administrators', async () => {
      await expect(warehouse('p1', platform)).resolves.toBeDefined();
      await expect(
        warehouses.create(
          platform,
          { name: 'P', code: 'P2' },
          { userId: 'u9', role: 'CUSTOMER' },
        ),
      ).rejects.toThrow(InventoryAccessDeniedError);
      expect(
        await warehouses.create(platform, { name: 'P', code: 'P3' }, admin),
      ).toMatchObject({ shopId: null });
    });

    it('propagates the shop ownership check', async () => {
      requireManageable.mockRejectedValueOnce(new Error('denied'));
      await expect(warehouse('hn')).rejects.toThrow('denied');
      expect(store.warehouses.size).toBe(0);
    });

    it('rechecks the shop and account inside the write transaction', async () => {
      const w = await warehouse('hn');
      await receive(w.id, 'v1', 10);
      // requireManageable (mocked) still passes: the change lands after that check.
      store.shops.set('s1', { ownerId: 'u1', sellable: false });
      await expect(receive(w.id)).rejects.toThrow(ShopUnavailableError);
      await expect(
        warehouses.update(shop, w.id, { version: 0, name: 'x' }, seller),
      ).rejects.toThrow(ShopUnavailableError);

      store.shops.set('s1', { ownerId: 'someone-else', sellable: true });
      await expect(receive(w.id)).rejects.toThrow(ShopAccessDeniedError);

      store.shops.set('s1', { ownerId: 'u1', sellable: true });
      store.inactiveUsers.add('u1');
      await expect(warehouse('dn')).rejects.toThrow(InventoryAccessDeniedError);

      store.shops.delete('s1');
      store.inactiveUsers.clear();
      await expect(receive(w.id)).rejects.toThrow(ShopNotFoundError);

      expect(store.warehouses.size).toBe(1);
      expect(store.movements).toHaveLength(1);
    });
  });

  describe('stock', () => {
    it('receives into a new stock row, then accumulates with a ledger entry each time', async () => {
      const w = await warehouse('hn');
      expect(await receive(w.id, 'v1', 10)).toMatchObject({
        onHand: 10,
        reserved: 0,
        available: 10,
        version: 1,
      });
      expect(await receive(w.id, 'v1', 5)).toMatchObject({
        onHand: 15,
        version: 2,
      });
      expect(
        store.movements.map((m) => [m.type, m.onHandDelta, m.actorUserId]),
      ).toEqual([
        ['RECEIPT', 10, 'u1'],
        ['RECEIPT', 5, 'u1'],
      ]);
    });

    it('only stocks variants owned by the warehouse scope', async () => {
      const w = await warehouse('hn');
      await expect(receive(w.id, 'other')).rejects.toThrow(
        InventoryNotFoundError,
      );
      await expect(receive(w.id, 'plat')).rejects.toThrow(
        InventoryNotFoundError,
      );
      await expect(receive(w.id, 'missing')).rejects.toThrow(
        InventoryNotFoundError,
      );

      const p = await warehouse('p1', platform);
      await expect(
        stock.receive(
          platform,
          { warehouseId: p.id, variantId: 'plat', quantity: 3, reason: 'r' },
          admin,
        ),
      ).resolves.toMatchObject({ onHand: 3 });
      await expect(
        stock.receive(
          platform,
          { warehouseId: p.id, variantId: 'v1', quantity: 3, reason: 'r' },
          admin,
        ),
      ).rejects.toThrow(InventoryNotFoundError);
    });

    it('cannot use another shop warehouse', async () => {
      const w = await warehouse('hn');
      await expect(
        stock.receive(
          { shopId: 's2' },
          { warehouseId: w.id, variantId: 'other', quantity: 1, reason: 'r' },
          seller,
        ),
      ).rejects.toThrow(InventoryNotFoundError);
    });

    it('rejects invalid quantities and reasons', async () => {
      const w = await warehouse('hn');
      for (const quantity of [0, -3, 1.5, 2_000_000_000])
        await expect(receive(w.id, 'v1', quantity)).rejects.toThrow(
          InventoryValidationError,
        );
      await expect(
        stock.receive(
          shop,
          { warehouseId: w.id, variantId: 'v1', quantity: 1, reason: ' ' },
          seller,
        ),
      ).rejects.toThrow(InventoryValidationError);
    });

    it('adjusts with the expected version and never below reserved units', async () => {
      const w = await warehouse('hn');
      const current = await receive(w.id, 'v1', 10);
      store.stocks.set(current.id, {
        ...store.stocks.get(current.id)!,
        reserved: 6,
      });
      const adjust = (quantityDelta: number, version: number) =>
        stock.adjust(
          shop,
          {
            warehouseId: w.id,
            variantId: 'v1',
            quantityDelta,
            reason: 'Count',
            version,
          },
          seller,
        );

      expect(await adjust(-4, current.version)).toMatchObject({
        onHand: 6,
        available: 0,
      });
      await expect(adjust(-1, current.version + 1)).rejects.toThrow(
        InsufficientStockError,
      );
      await expect(adjust(-1, current.version)).rejects.toThrow(
        InventoryStaleVersionError,
      );
      await expect(adjust(0, current.version + 1)).rejects.toThrow(
        InventoryValidationError,
      );
      await expect(
        stock.adjust(
          shop,
          {
            warehouseId: w.id,
            variantId: 'v2',
            quantityDelta: 1,
            reason: 'x',
            version: 0,
          },
          seller,
        ),
      ).rejects.toThrow(InventoryNotFoundError);
      const adjustments = store.movements.filter(
        (m) => m.type === 'ADJUSTMENT',
      );
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].onHandDelta).toBe(-4);
    });

    it('transfers atomically between warehouses with linked movements', async () => {
      const a = await warehouse('a');
      const b = await warehouse('b');
      await receive(a.id, 'v1', 10);

      const result = await stock.transfer(
        shop,
        {
          fromWarehouseId: a.id,
          toWarehouseId: b.id,
          variantId: 'v1',
          quantity: 4,
          reason: 'Rebalance',
        },
        seller,
      );
      expect(result.from).toMatchObject({ onHand: 6 });
      expect(result.to).toMatchObject({ onHand: 4, warehouseId: b.id });
      const [out, into] = store.movements.slice(-2);
      expect([out.type, out.onHandDelta, into.type, into.onHandDelta]).toEqual([
        'TRANSFER_OUT',
        -4,
        'TRANSFER_IN',
        4,
      ]);
      expect(out.transferId).toBe(result.transferId);
      expect(into.transferId).toBe(result.transferId);
    });

    it('refuses to transfer reserved units and leaves both warehouses untouched', async () => {
      const a = await warehouse('a');
      const b = await warehouse('b');
      const source = await receive(a.id, 'v1', 10);
      store.stocks.set(source.id, {
        ...store.stocks.get(source.id)!,
        reserved: 8,
      });
      const before = [...store.stocks.values()];
      const movements = store.movements.length;

      await expect(
        stock.transfer(
          shop,
          {
            fromWarehouseId: a.id,
            toWarehouseId: b.id,
            variantId: 'v1',
            quantity: 3,
            reason: 'x',
          },
          seller,
        ),
      ).rejects.toThrow(InsufficientStockError);
      expect([...store.stocks.values()]).toEqual(before);
      expect(store.movements).toHaveLength(movements);
    });

    it('validates transfer endpoints', async () => {
      const a = await warehouse('a');
      await receive(a.id, 'v1', 5);
      await expect(
        stock.transfer(
          shop,
          {
            fromWarehouseId: a.id,
            toWarehouseId: a.id,
            variantId: 'v1',
            quantity: 1,
            reason: 'x',
          },
          seller,
        ),
      ).rejects.toThrow(InventoryValidationError);
      await expect(
        stock.transfer(
          shop,
          {
            fromWarehouseId: a.id,
            toWarehouseId: 'nope',
            variantId: 'v1',
            quantity: 1,
            reason: 'x',
          },
          seller,
        ),
      ).rejects.toThrow(InventoryNotFoundError);
    });

    it('lists stock and movements only inside the addressed scope', async () => {
      const a = await warehouse('a');
      const p = await warehouse('p', platform);
      await receive(a.id, 'v1', 3);
      await stock.receive(
        platform,
        { warehouseId: p.id, variantId: 'plat', quantity: 9, reason: 'r' },
        admin,
      );

      const mine = await stock.list(shop, { page: 1, limit: 20 }, seller);
      expect(mine.items.map((s) => s.variantId)).toEqual(['v1']);
      expect(mine).toMatchObject({ total: 1, pages: 1 });
      expect(
        (await stock.list(platform, { page: 1, limit: 20 }, admin)).items,
      ).toHaveLength(1);
      expect(
        (await stock.movements(shop, { page: 1, limit: 20 }, seller)).items,
      ).toHaveLength(1);
      expect(
        (
          await stock.list(
            shop,
            { page: 1, limit: 20, variantId: 'zzz' },
            seller,
          )
        ).items,
      ).toEqual([]);
      await expect(
        stock.list(shop, { page: 0, limit: 20 }, seller),
      ).rejects.toThrow(InventoryValidationError);
      await expect(
        stock.list(shop, { page: 1, limit: 101 }, seller),
      ).rejects.toThrow(InventoryValidationError);
    });
  });

  describe('availability', () => {
    it('reports only in-stock status from active warehouses', async () => {
      const a = await warehouse('a');
      const b = await warehouse('b');
      await receive(a.id, 'v1', 2);
      await receive(b.id, 'v2', 4);
      store.warehouses.set(b.id, {
        ...store.warehouses.get(b.id)!,
        isActive: false,
      });

      expect(await availability.check(['v1', 'v2', 'v3', 'v1'])).toEqual([
        { variantId: 'v1', inStock: true },
        { variantId: 'v2', inStock: false },
        { variantId: 'v3', inStock: false },
      ]);
    });

    it('counts available units, not on-hand', async () => {
      const a = await warehouse('a');
      const s = await receive(a.id, 'v1', 2);
      store.stocks.set(s.id, { ...store.stocks.get(s.id)!, reserved: 2 });
      expect(await availability.check(['v1'])).toEqual([
        { variantId: 'v1', inStock: false },
      ]);
    });

    it('validates the id list', async () => {
      await expect(availability.check([])).rejects.toThrow(
        InventoryValidationError,
      );
      await expect(
        availability.check(Array.from({ length: 101 }, (_, i) => `v${i}`)),
      ).rejects.toThrow(InventoryValidationError);
    });
  });
});
