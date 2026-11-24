import type {
  ShopAccess,
  ShopActor,
} from '../../../shops/contracts/shops.api.js';
import {
  createWarehouse,
  updateWarehouse,
} from '../../domain/entities/warehouse.js';
import type { Warehouse } from '../../domain/entities/warehouse.js';
import {
  InventoryNotFoundError,
  InventoryStaleVersionError,
} from '../../domain/errors/inventory.errors.js';
import {
  inventoryId,
  inventoryVersion,
} from '../../domain/policies/inventory-input.policy.js';
import type {
  InventoryClock,
  InventoryIdGenerator,
} from '../ports/inventory-runtime.js';
import type { InventoryUnitOfWork } from '../ports/inventory-unit-of-work.js';
import { retryOnConflict } from '../shared/inventory-retry.js';
import { authorizeScope } from '../shared/inventory-scope.js';
import type { InventoryScope } from '../shared/inventory-scope.js';

export class InventoryWarehouseService {
  constructor(
    private readonly unitOfWork: InventoryUnitOfWork,
    private readonly shops: ShopAccess,
    private readonly ids: InventoryIdGenerator,
    private readonly clock: InventoryClock,
  ) {}

  async create(
    scope: InventoryScope,
    input: { name: string; code: string; priority?: number },
    actor: ShopActor,
  ): Promise<Warehouse> {
    await authorizeScope(this.shops, scope, actor);
    const warehouse = createWarehouse({
      id: this.ids.next(),
      shopId: scope.shopId,
      name: input.name,
      code: input.code,
      priority: input.priority,
      now: this.clock.now(),
    });
    await this.unitOfWork.run((tx) => tx.warehouses.insert(warehouse));
    return warehouse;
  }

  async list(scope: InventoryScope, actor: ShopActor): Promise<Warehouse[]> {
    await authorizeScope(this.shops, scope, actor);
    return this.unitOfWork.read((tx) => tx.warehouses.listByShop(scope.shopId));
  }

  async update(
    scope: InventoryScope,
    id: string,
    input: {
      version: number;
      name?: string;
      priority?: number;
      isActive?: boolean;
    },
    actor: ShopActor,
  ): Promise<Warehouse> {
    await authorizeScope(this.shops, scope, actor);
    const expectedVersion = inventoryVersion(input.version);
    const warehouseId = inventoryId(id, 'warehouse identifier');
    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        const current = await tx.warehouses.findById(warehouseId);
        // A warehouse of another shop is reported as missing, not forbidden.
        if (!current || current.shopId !== scope.shopId)
          throw new InventoryNotFoundError('Warehouse not found');
        if (current.version !== expectedVersion)
          throw new InventoryStaleVersionError(
            'Warehouse changed; reload it before retrying',
          );
        const candidate = updateWarehouse(
          current,
          {
            name: input.name,
            priority: input.priority,
            isActive: input.isActive,
          },
          this.clock.now(),
        );
        return tx.warehouses.save(candidate, expectedVersion);
      }),
    );
  }
}
