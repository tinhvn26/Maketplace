import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { CatalogAdminService } from './application/admin/catalog-admin.service.js';
import { CatalogQueryService } from './application/query/catalog-query.service.js';
import { CATALOG_REPOSITORY } from './application/ports/catalog.repository.js';
import type {
  CatalogAdminRepository,
  PublicCatalogReader,
} from './application/ports/catalog.repository.js';
import { PrismaCatalogRepository } from './infrastructure/persistence/prisma-catalog.repository.js';
import { AdminCatalogController } from './presentation/http/controllers/admin-catalog.controller.js';
import { CatalogController } from './presentation/http/controllers/catalog.controller.js';
import { CatalogExceptionFilter } from './presentation/http/filters/catalog-exception.filter.js';
import { CatalogAdminGuard } from './presentation/http/guards/catalog-admin.guard.js';
import { CatalogAttributesMiddleware } from './presentation/http/middleware/catalog-attributes.middleware.js';
import { ShopsModule } from '../shops/shops.module.js';
import { SHOP_ACCESS } from '../shops/contracts/shops.api.js';
import type { ShopAccess } from '../shops/contracts/shops.api.js';
import { MediaModule } from '../media/media.module.js';
import { MEDIA_ASSETS } from '../media/contracts/media.api.js';
import type { MediaAssets } from '../media/contracts/media.api.js';
import { CatalogSellerService } from './application/seller/catalog-seller.service.js';
import { CatalogReviewService } from './application/review/catalog-review.service.js';
import { CatalogQuoteService } from './application/quote/catalog-quote.service.js';
import { CatalogTaxonomyService } from './application/taxonomy/catalog-taxonomy.service.js';
import type { CatalogTaxonomyRepository } from './application/ports/catalog-taxonomy.repository.js';
import { CATALOG_WORKFLOW } from './application/ports/catalog-workflow.repository.js';
import type { CatalogWorkflowRepository } from './application/ports/catalog-workflow.repository.js';
import { CATALOG_PURCHASING_READER } from './application/ports/catalog-purchasing.reader.js';
import type { CatalogPurchasingReader } from './application/ports/catalog-purchasing.reader.js';
import { CATALOG_PRICING } from './contracts/catalog-pricing.api.js';
import { PrismaCatalogWorkflowRepository } from './infrastructure/persistence/prisma-catalog-workflow.repository.js';
import { PrismaCatalogPurchasingReader } from './infrastructure/persistence/prisma-catalog-purchasing.reader.js';
import { SellerCatalogController } from './presentation/http/controllers/seller-catalog.controller.js';
import { CatalogReviewController } from './presentation/http/controllers/catalog-review.controller.js';
import { CatalogQuoteController } from './presentation/http/controllers/catalog-quote.controller.js';
import { CatalogDiscoveryController } from './presentation/http/controllers/catalog-discovery.controller.js';
import { AdminCatalogBrandsController } from './presentation/http/controllers/admin-catalog-brands.controller.js';
import { CatalogSellerGuard } from './presentation/http/guards/catalog-seller.guard.js';

@Module({
  imports: [DatabaseModule, IdentityModule, ShopsModule, MediaModule],
  controllers: [
    CatalogDiscoveryController,
    CatalogQuoteController,
    CatalogReviewController,
    SellerCatalogController,
    CatalogController,
    AdminCatalogController,
    AdminCatalogBrandsController,
  ],
  providers: [
    { provide: CATALOG_REPOSITORY, useClass: PrismaCatalogRepository },
    { provide: PrismaCatalogRepository, useExisting: CATALOG_REPOSITORY },
    { provide: CATALOG_WORKFLOW, useClass: PrismaCatalogWorkflowRepository },
    {
      provide: CATALOG_PURCHASING_READER,
      useClass: PrismaCatalogPurchasingReader,
    },
    {
      provide: CatalogAdminService,
      inject: [CATALOG_REPOSITORY, MEDIA_ASSETS],
      useFactory: (catalog: CatalogAdminRepository, media: MediaAssets) =>
        new CatalogAdminService(
          catalog,
          { next: randomUUID },
          { now: () => new Date() },
          media,
        ),
    },
    {
      provide: CatalogQueryService,
      inject: [CATALOG_REPOSITORY],
      useFactory: (catalog: PublicCatalogReader) =>
        new CatalogQueryService(catalog),
    },
    {
      provide: CatalogSellerService,
      inject: [CATALOG_REPOSITORY, CATALOG_WORKFLOW, SHOP_ACCESS, MEDIA_ASSETS],
      useFactory: (
        catalog: CatalogAdminRepository,
        workflow: CatalogWorkflowRepository,
        shops: ShopAccess,
        media: MediaAssets,
      ) =>
        new CatalogSellerService(
          catalog,
          workflow,
          shops,
          media,
          { next: randomUUID },
          { now: () => new Date() },
        ),
    },
    {
      provide: CatalogReviewService,
      inject: [CATALOG_WORKFLOW],
      useFactory: (workflow: CatalogWorkflowRepository) =>
        new CatalogReviewService(workflow),
    },
    {
      provide: CatalogQuoteService,
      inject: [CATALOG_PURCHASING_READER],
      useFactory: (reader: CatalogPurchasingReader) =>
        new CatalogQuoteService(reader, { now: () => new Date() }),
    },
    { provide: CATALOG_PRICING, useExisting: CatalogQuoteService },
    {
      provide: CatalogTaxonomyService,
      inject: [CATALOG_REPOSITORY],
      useFactory: (catalog: CatalogTaxonomyRepository) =>
        new CatalogTaxonomyService(
          catalog,
          { now: () => new Date() },
          { next: randomUUID },
        ),
    },
    CatalogAdminGuard,
    CatalogSellerGuard,
    CatalogExceptionFilter,
  ],
  exports: [CatalogQueryService, CATALOG_PRICING],
})
export class CatalogModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Validate free-form maps before Nest removes reserved prototype keys.
    consumer
      .apply(CatalogAttributesMiddleware)
      .forRoutes(AdminCatalogController, SellerCatalogController);
  }
}
