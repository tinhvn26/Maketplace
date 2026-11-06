CREATE TABLE "Shop" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK("status" IN ('ACTIVE','SUSPENDED')),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK("version" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Shop_slug_key" ON "Shop"("slug");
CREATE INDEX "Shop_ownerId_status_idx" ON "Shop"("ownerId", "status");

CREATE TABLE "CatalogBrand" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK("version" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CatalogBrand_slug_key" ON "CatalogBrand"("slug");
ALTER TABLE "CatalogCategory" ADD COLUMN "parentId" TEXT REFERENCES "CatalogCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogCategory" ADD COLUMN "attributeDefinitions" JSONB NOT NULL DEFAULT '[]' CHECK(json_valid("attributeDefinitions") AND json_type("attributeDefinitions") = 'array');
CREATE INDEX "CatalogCategory_parentId_idx" ON "CatalogCategory"("parentId");
ALTER TABLE "CatalogProduct" ADD COLUMN "shopId" TEXT REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogProduct" ADD COLUMN "brandId" TEXT REFERENCES "CatalogBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogProduct" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogVariant" ADD COLUMN "images" JSONB NOT NULL DEFAULT '[]' CHECK(json_valid("images") AND json_type("images") = 'array');
CREATE INDEX "CatalogProduct_shopId_status_createdAt_id_idx" ON "CatalogProduct"("shopId", "status", "createdAt" DESC, "id" DESC);
CREATE INDEX "CatalogProduct_brandId_status_idx" ON "CatalogProduct"("brandId", "status");
CREATE INDEX "CatalogProduct_status_name_id_idx" ON "CatalogProduct"("status", "name", "id" DESC);
CREATE INDEX "CatalogProduct_price_asc_idx" ON "CatalogProduct"("status", "minPriceAmount", "createdAt" DESC, "id" DESC);
CREATE INDEX "CatalogProduct_brand_browse_idx" ON "CatalogProduct"("brandId", "status", "createdAt" DESC, "id" DESC);
CREATE INDEX "CatalogProduct_category_status_createdAt_id_idx" ON "CatalogProduct"("categoryId", "status", "createdAt" DESC, "id" DESC);

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT, "ownerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY' CHECK("status" IN ('READY','DELETED')),
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL CHECK("mimeType" IN ('image/png','image/jpeg','image/webp')),
  "byteSize" INTEGER NOT NULL CHECK("byteSize" BETWEEN 1 AND 5242880),
  "width" INTEGER NOT NULL CHECK("width" BETWEEN 1 AND 12000),
  "height" INTEGER NOT NULL CHECK("height" BETWEEN 1 AND 12000),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK("width" * "height" <= 40000000)
);
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_shopId_status_createdAt_idx" ON "MediaAsset"("shopId", "status", "createdAt");
CREATE TABLE "MediaUsage" (
  "assetId" TEXT NOT NULL, "resourceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'CATALOG_PRODUCT',
  PRIMARY KEY("assetId", "kind", "resourceId"),
  FOREIGN KEY("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MediaUsage_kind_resourceId_idx" ON "MediaUsage"("kind", "resourceId");

CREATE TABLE "CatalogReview" (
  "id" TEXT NOT NULL PRIMARY KEY, "productId" TEXT NOT NULL,
  "baseVersion" INTEGER NOT NULL CHECK("baseVersion" >= 0),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK("version" >= 0),
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK("status" IN ('DRAFT','PENDING','APPROVED','REJECTED')),
  "snapshot" JSONB NOT NULL CHECK(json_valid("snapshot")),
  "submittedBy" TEXT, "reviewedBy" TEXT, "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY("productId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogReview_active_product_key" ON "CatalogReview"("productId") WHERE "status" IN ('DRAFT','PENDING');
CREATE INDEX "CatalogReview_status_createdAt_id_idx" ON "CatalogReview"("status", "createdAt", "id");
CREATE INDEX "CatalogReview_productId_createdAt_idx" ON "CatalogReview"("productId", "createdAt");
CREATE TABLE "CatalogAudit" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "shopId" TEXT,
  "before" JSONB, "after" JSONB, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CatalogAudit_entityType_entityId_createdAt_id_idx" ON "CatalogAudit"("entityType", "entityId", "createdAt", "id");
CREATE INDEX "CatalogAudit_shopId_createdAt_id_idx" ON "CatalogAudit"("shopId", "createdAt", "id");
