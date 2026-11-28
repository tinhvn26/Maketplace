import type { CatalogVariants } from '../../../catalog/contracts/catalog-variants.api.js';
import type {
  ShopAccess,
  ShopActor,
} from '../../../shops/contracts/shops.api.js';
import {
  adjustStock,
  createStock,
  receiveStock,
} from '../../domain/entities/stock.js';
import type { Stock } from '../../domain/entities/stock.js';
import { stockMovement } from '../../domain/entities/stock-movement.js';
import type { StockMovementRecord } from '../../domain/entities/stock-movement.js';
import {
  InventoryNotFoundError,
  InventoryStaleVersionError,
  InventoryValidationError,
} from '../../domain/errors/inventory.errors.js';
import {
  inventoryId,
  inventoryVersion,
  movementReason,
  positiveQuantity,
} from '../../domain/policies/inventory-input.policy.js';
import type {
  InventoryClock,
  InventoryIdGenerator,
} from '../ports/inventory-runtime.js';
import type {
  InventoryRepositories,
  InventoryUnitOfWork,
} from '../ports/inventory-unit-of-work.js';
import { retryOnConflict } from '../shared/inventory-retry.js';
import { authorizeScope, recheckScope } from '../shared/inventory-scope.js';
import type { InventoryScope } from '../shared/inventory-scope.js';
import {
  normalizePaging,
  toPage,
  toStockResult,
} from '../shared/inventory.results.js';
import type {
  InventoryPage,
  StockResult,
} from '../shared/inventory.results.js';

export interface StockListQuery {
  warehouseId?: string;
  variantId?: string;
  page: number;
  limit: number;
}

export class InventoryStockService {
  constructor(
    private readonly unitOfWork: InventoryUnitOfWork,
    private readonly shops: ShopAccess,
    private readonly variants: CatalogVariants,
    private readonly ids: InventoryIdGenerator,
    private readonly clock: InventoryClock,
  ) {}

  async receive(
    scope: InventoryScope,
    input: {
      warehouseId: string;
      variantId: string;
      quantity: number;
      reason: string;
    },
    actor: ShopActor,
  ): Promise<StockResult> {
    await authorizeScope(this.shops, scope, actor);
    const warehouseId = inventoryId(input.warehouseId, 'warehouse identifier');
    const variantId = inventoryId(input.variantId, 'variant identifier');
    const quantity = positiveQuantity(input.quantity);
    const reason = movementReason(input.reason);
    await this.assertVariantInScope(scope, variantId);
    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        await recheckScope(tx.access, scope, actor);
        await this.requireWarehouse(tx, scope, warehouseId);
        const now = this.clock.now();
        const current =
          (await tx.stocks.findByKey(warehouseId, variantId)) ??
          (await this.insertEmpty(tx, warehouseId, variantId, now));
        const saved = await tx.stocks.save(
          receiveStock(current, quantity, now),
          current.version,
        );
        await tx.stocks.appendMovements([
          stockMovement({
            stockId: saved.id,
            type: 'RECEIPT',
            onHandDelta: quantity,
            reservedDelta: 0,
            reason,
            actorUserId: actor.userId,
            createdAt: now,
          }),
        ]);
        return toStockResult(saved);
      }),
    );
  }

  async adjust(
    scope: InventoryScope,
    input: {
      warehouseId: string;
      variantId: string;
      quantityDelta: number;
      reason: string;
      version: number;
    },
    actor: ShopActor,
  ): Promise<StockResult> {
    await authorizeScope(this.shops, scope, actor);
    const warehouseId = inventoryId(input.warehouseId, 'warehouse identifier');
    const variantId = inventoryId(input.variantId, 'variant identifier');
    const reason = movementReason(input.reason);
    const expectedVersion = inventoryVersion(input.version);
    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        await recheckScope(tx.access, scope, actor);
        await this.requireWarehouse(tx, scope, warehouseId);
        const current = await tx.stocks.findByKey(warehouseId, variantId);
        if (!current) throw new InventoryNotFoundError('Stock not found');
        if (current.version !== expectedVersion)
          throw new InventoryStaleVersionError(
            'Stock changed; reload it before retrying',
          );
        const now = this.clock.now();
        const next = adjustStock(current, input.quantityDelta, now);
        const saved = await tx.stocks.save(next, current.version);
        await tx.stocks.appendMovements([
          stockMovement({
            stockId: saved.id,
            type: 'ADJUSTMENT',
            onHandDelta: next.onHand - current.onHand,
            reservedDelta: 0,
            reason,
            actorUserId: actor.userId,
            createdAt: now,
          }),
        ]);
        return toStockResult(saved);
      }),
    );
  }

  /** Moves units between two warehouses of the same scope, atomically and instantly. */
  async transfer(
    scope: InventoryScope,
    input: {
      fromWarehouseId: string;
      toWarehouseId: string;
      variantId: string;
      quantity: number;
      reason: string;
    },
    actor: ShopActor,
  ): Promise<{ from: StockResult; to: StockResult; transferId: string }> {
    await authorizeScope(this.shops, scope, actor);
    const fromId = inventoryId(input.fromWarehouseId, 'warehouse identifier');
    const toId = inventoryId(input.toWarehouseId, 'warehouse identifier');
    const variantId = inventoryId(input.variantId, 'variant identifier');
    const quantity = positiveQuantity(input.quantity);
    const reason = movementReason(input.reason);
    if (fromId === toId)
      throw new InventoryValidationError(
        'Source and destination warehouses must differ',
      );
    await this.assertVariantInScope(scope, variantId);
    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        await recheckScope(tx.access, scope, actor);
        await this.requireWarehouse(tx, scope, fromId);
        await this.requireWarehouse(tx, scope, toId);
        const source = await tx.stocks.findByKey(fromId, variantId);
        if (!source) throw new InventoryNotFoundError('Stock not found');
        const now = this.clock.now();
        const target =
          (await tx.stocks.findByKey(toId, variantId)) ??
          (await this.insertEmpty(tx, toId, variantId, now));
        // Never takes units that are reserved: on-hand may not fall below reserved.
        const from = await tx.stocks.save(
          adjustStock(source, -quantity, now),
          source.version,
        );
        const to = await tx.stocks.save(
          receiveStock(target, quantity, now),
          target.version,
        );
        const transferId = this.ids.next();
        await tx.stocks.appendMovements([
          stockMovement({
            stockId: from.id,
            type: 'TRANSFER_OUT',
            onHandDelta: -quantity,
            reservedDelta: 0,
            reason,
            actorUserId: actor.userId,
            transferId,
            createdAt: now,
          }),
          stockMovement({
            stockId: to.id,
            type: 'TRANSFER_IN',
            onHandDelta: quantity,
            reservedDelta: 0,
            reason,
            actorUserId: actor.userId,
            transferId,
            createdAt: now,
          }),
        ]);
        return {
          from: toStockResult(from),
          to: toStockResult(to),
          transferId,
        };
      }),
    );
  }

  async list(
    scope: InventoryScope,
    query: StockListQuery,
    actor: ShopActor,
  ): Promise<InventoryPage<StockResult>> {
    await authorizeScope(this.shops, scope, actor);
    const { page, limit } = normalizePaging(query.page, query.limit);
    const result = await this.unitOfWork.read((tx) =>
      tx.stocks.list({
        shopId: scope.shopId,
        warehouseId: query.warehouseId,
        variantId: query.variantId,
        page,
        limit,
      }),
    );
    return toPage(
      { items: result.items.map(toStockResult), total: result.total },
      page,
      limit,
    );
  }

  async movements(
    scope: InventoryScope,
    query: StockListQuery,
    actor: ShopActor,
  ): Promise<InventoryPage<StockMovementRecord>> {
    await authorizeScope(this.shops, scope, actor);
    const { page, limit } = normalizePaging(query.page, query.limit);
    const result = await this.unitOfWork.read((tx) =>
      tx.stocks.listMovements({
        shopId: scope.shopId,
        warehouseId: query.warehouseId,
        variantId: query.variantId,
        page,
        limit,
      }),
    );
    return toPage(result, page, limit);
  }

  /** A warehouse of another shop is reported as missing, not forbidden. */
  private async requireWarehouse(
    tx: InventoryRepositories,
    scope: InventoryScope,
    id: string,
  ): Promise<void> {
    const warehouse = await tx.warehouses.findById(id);
    if (!warehouse || warehouse.shopId !== scope.shopId)
      throw new InventoryNotFoundError('Warehouse not found');
  }

  /** Stock may only be kept for variants that belong to the warehouse's own shop. */
  private async assertVariantInScope(
    scope: InventoryScope,
    variantId: string,
  ): Promise<void> {
    const [owner] = await this.variants.findVariantShops([variantId]);
    if (!owner || owner.shopId !== scope.shopId)
      throw new InventoryNotFoundError('Variant not found for this shop');
  }

  private async insertEmpty(
    tx: InventoryRepositories,
    warehouseId: string,
    variantId: string,
    now: Date,
  ): Promise<Stock> {
    const stock = createStock({
      id: this.ids.next(),
      warehouseId,
      variantId,
      now,
    });
    await tx.stocks.insert(stock);
    return stock;
  }
}
