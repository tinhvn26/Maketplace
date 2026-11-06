CREATE TABLE "CatalogCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    CONSTRAINT "CatalogProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CatalogVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL CHECK ("priceAmount" >= 0 AND "priceAmount" <= 2147483647),
    "currency" TEXT NOT NULL DEFAULT 'VND' CHECK ("currency" = 'VND'),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "CatalogVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CatalogCategory_slug_key" ON "CatalogCategory"("slug");
CREATE UNIQUE INDEX "CatalogProduct_slug_key" ON "CatalogProduct"("slug");
CREATE UNIQUE INDEX "CatalogVariant_sku_key" ON "CatalogVariant"("sku");
CREATE INDEX "CatalogProduct_status_createdAt_id_idx" ON "CatalogProduct"("status", "createdAt", "id");
CREATE INDEX "CatalogProduct_categoryId_status_idx" ON "CatalogProduct"("categoryId", "status");
CREATE INDEX "CatalogVariant_productId_isActive_idx" ON "CatalogVariant"("productId", "isActive");
