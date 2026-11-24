import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import inventoryConfig from '../../config/inventory.config.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CATALOG_PRICING } from '../catalog/contracts/catalog-pricing.api.js';
import type { CatalogPricing } from '../catalog/contracts/catalog-pricing.api.js';
import { CATALOG_VARIANTS } from '../catalog/contracts/catalog-variants.api.js';
import type { CatalogVariants } from '../catalog/contracts/catalog-variants.api.js';
import { ShopsModule } from '../shops/shops.module.js';
import { SHOP_ACCESS } from '../shops/contracts/shops.api.js';
import type { ShopAccess } from '../shops/contracts/shops.api.js';
import { InventoryAvailabilityService } from './application/availability/inventory-availability.service.js';
import { INVENTORY_UNIT_OF_WORK } from './application/ports/inventory-unit-of-work.js';
import type { InventoryUnitOfWork } from './application/ports/inventory-unit-of-work.js';
import { InventoryReservationService } from './application/reservations/inventory-reservation.service.js';
import { InventoryStockService } from './application/stock/inventory-stock.service.js';
import { InventoryWarehouseService } from './application/warehouses/inventory-warehouse.service.js';
import { INVENTORY_RESERVATIONS } from './contracts/inventory.api.js';
import { PrismaInventoryUnitOfWork } from './infrastructure/persistence/prisma-inventory-unit-of-work.js';

const ids = { next: randomUUID };
const clock = { now: () => new Date() };

/** Domain and application wiring. Transport adapters live in the HTTP and worker modules. */
@Module({
  imports: [
    DatabaseModule,
    ShopsModule,
    CatalogModule,
    ConfigModule.forFeature(inventoryConfig),
  ],
  providers: [
    { provide: INVENTORY_UNIT_OF_WORK, useClass: PrismaInventoryUnitOfWork },
    {
      provide: InventoryWarehouseService,
      inject: [INVENTORY_UNIT_OF_WORK, SHOP_ACCESS],
      useFactory: (unitOfWork: InventoryUnitOfWork, shops: ShopAccess) =>
        new InventoryWarehouseService(unitOfWork, shops, ids, clock),
    },
    {
      provide: InventoryStockService,
      inject: [INVENTORY_UNIT_OF_WORK, SHOP_ACCESS, CATALOG_VARIANTS],
      useFactory: (
        unitOfWork: InventoryUnitOfWork,
        shops: ShopAccess,
        variants: CatalogVariants,
      ) => new InventoryStockService(unitOfWork, shops, variants, ids, clock),
    },
    {
      provide: InventoryReservationService,
      inject: [INVENTORY_UNIT_OF_WORK, CATALOG_PRICING, inventoryConfig.KEY],
      useFactory: (
        unitOfWork: InventoryUnitOfWork,
        pricing: CatalogPricing,
        config: ConfigType<typeof inventoryConfig>,
      ) =>
        new InventoryReservationService(
          unitOfWork,
          pricing,
          { ttlSeconds: config.reservationTtlSeconds },
          ids,
          clock,
        ),
    },
    {
      provide: INVENTORY_RESERVATIONS,
      useExisting: InventoryReservationService,
    },
    {
      provide: InventoryAvailabilityService,
      inject: [INVENTORY_UNIT_OF_WORK],
      useFactory: (unitOfWork: InventoryUnitOfWork) =>
        new InventoryAvailabilityService(unitOfWork),
    },
  ],
  exports: [
    INVENTORY_RESERVATIONS,
    InventoryWarehouseService,
    InventoryStockService,
    InventoryAvailabilityService,
  ],
})
export class InventoryModule {}
