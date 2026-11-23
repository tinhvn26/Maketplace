import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdentityModule } from './modules/identity/identity.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryHttpModule } from './modules/inventory/inventory.http.module.js';
import { InventoryWorkerModule } from './modules/inventory/inventory.worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(),
    IdentityModule,
    CatalogModule,
    InventoryHttpModule,
    InventoryWorkerModule,
  ],
})
export class AppModule {}
