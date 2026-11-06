import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SHOP_ACCESS } from './contracts/shops.api.js';
import { SHOP_REPOSITORY } from './application/ports/shop.repository.js';
import type { ShopRepository } from './application/ports/shop.repository.js';
import { ShopsService } from './application/shops.service.js';
import { PrismaShopRepository } from './infrastructure/persistence/prisma-shop.repository.js';
import { ShopsController } from './presentation/http/controllers/shops.controller.js';
import { AdminShopsController } from './presentation/http/controllers/admin-shops.controller.js';
import { ShopsExceptionFilter } from './presentation/http/filters/shops-exception.filter.js';
import { ShopsAuthenticatedGuard } from './presentation/http/guards/shops-authenticated.guard.js';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [ShopsController, AdminShopsController],
  providers: [
    PrismaShopRepository,
    { provide: SHOP_REPOSITORY, useExisting: PrismaShopRepository },
    { provide: SHOP_ACCESS, useExisting: PrismaShopRepository },
    {
      provide: ShopsService,
      inject: [SHOP_REPOSITORY],
      useFactory: (shops: ShopRepository) =>
        new ShopsService(
          shops,
          { next: randomUUID },
          { now: () => new Date() },
        ),
    },
    ShopsExceptionFilter,
    ShopsAuthenticatedGuard,
  ],
  exports: [SHOP_ACCESS],
})
export class ShopsModule {}
