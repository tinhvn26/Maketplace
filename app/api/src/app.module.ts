import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdentityModule } from './modules/identity/identity.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryHttpModule } from './modules/inventory/inventory.http.module.js';
import { InventoryWorkerModule } from './modules/inventory/inventory.worker.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(),
    IdentityModule,
    CatalogModule,
    InventoryHttpModule,
    OrdersModule,
    // Evaluated after ConfigModule.forRoot() above has loaded .env.
    ...(process.env.INVENTORY_EMBEDDED_WORKER === 'false'
      ? []
      : [InventoryWorkerModule]),
  ],
})
export class AppModule {}
