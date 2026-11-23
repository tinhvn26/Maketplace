import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { InventoryModule } from './inventory.module.js';
import { AdminInventoryController } from './presentation/http/controllers/admin-inventory.controller.js';
import { InventoryAvailabilityController } from './presentation/http/controllers/inventory-availability.controller.js';
import { SellerInventoryController } from './presentation/http/controllers/seller-inventory.controller.js';
import { InventoryExceptionFilter } from './presentation/http/filters/inventory-exception.filter.js';
import { InventoryAuthenticatedGuard } from './presentation/http/guards/inventory-authenticated.guard.js';

@Module({
  imports: [InventoryModule, IdentityModule],
  controllers: [
    SellerInventoryController,
    AdminInventoryController,
    InventoryAvailabilityController,
  ],
  providers: [InventoryAuthenticatedGuard, InventoryExceptionFilter],
})
export class InventoryHttpModule {}
