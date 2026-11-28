import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CATALOG_PRICING } from '../catalog/contracts/catalog-pricing.api.js';
import type { CatalogPricing } from '../catalog/contracts/catalog-pricing.api.js';
import { IdentityModule } from '../identity/identity.module.js';
import { INVENTORY_RESERVATIONS } from '../inventory/contracts/inventory.api.js';
import type { InventoryReservations } from '../inventory/contracts/inventory.api.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SHOP_ACCESS } from '../shops/contracts/shops.api.js';
import type { ShopAccess } from '../shops/contracts/shops.api.js';
import { ShopsModule } from '../shops/shops.module.js';
import { OrderBuyerService } from './application/buyer/order-buyer.service.js';
import { OrderCheckoutService } from './application/checkout/order-checkout.service.js';
import { OrderFulfilmentService } from './application/fulfilment/order-fulfilment.service.js';
import { ORDER_UNIT_OF_WORK } from './application/ports/order-unit-of-work.js';
import type { OrderUnitOfWork } from './application/ports/order-unit-of-work.js';
import { PrismaOrderUnitOfWork } from './infrastructure/persistence/prisma-order-unit-of-work.js';
import { AdminOrdersController } from './presentation/http/controllers/admin-orders.controller.js';
import { OrdersController } from './presentation/http/controllers/orders.controller.js';
import { SellerOrdersController } from './presentation/http/controllers/seller-orders.controller.js';
import { OrdersExceptionFilter } from './presentation/http/filters/orders-exception.filter.js';
import { OrdersAuthenticatedGuard } from './presentation/http/guards/orders-authenticated.guard.js';

const ids = { next: randomUUID };
const clock = { now: () => new Date() };

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    ShopsModule,
    CatalogModule,
    InventoryModule,
  ],
  controllers: [
    OrdersController,
    SellerOrdersController,
    AdminOrdersController,
  ],
  providers: [
    { provide: ORDER_UNIT_OF_WORK, useClass: PrismaOrderUnitOfWork },
    {
      provide: OrderCheckoutService,
      inject: [ORDER_UNIT_OF_WORK, CATALOG_PRICING, INVENTORY_RESERVATIONS],
      useFactory: (
        unitOfWork: OrderUnitOfWork,
        pricing: CatalogPricing,
        reservations: InventoryReservations,
      ) =>
        new OrderCheckoutService(unitOfWork, pricing, reservations, ids, clock),
    },
    {
      provide: OrderBuyerService,
      inject: [ORDER_UNIT_OF_WORK, INVENTORY_RESERVATIONS],
      useFactory: (
        unitOfWork: OrderUnitOfWork,
        reservations: InventoryReservations,
      ) => new OrderBuyerService(unitOfWork, reservations, clock),
    },
    {
      provide: OrderFulfilmentService,
      inject: [ORDER_UNIT_OF_WORK, SHOP_ACCESS, INVENTORY_RESERVATIONS],
      useFactory: (
        unitOfWork: OrderUnitOfWork,
        shops: ShopAccess,
        reservations: InventoryReservations,
      ) => new OrderFulfilmentService(unitOfWork, shops, reservations, clock),
    },
    OrdersAuthenticatedGuard,
    OrdersExceptionFilter,
  ],
})
export class OrdersModule {}
