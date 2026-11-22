CREATE TABLE "InventoryWarehouse" (
  "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT,
  "name" TEXT NOT NULL CHECK(length(trim("name")) BETWEEN 1 AND 100),
  "code" TEXT NOT NULL CHECK(length("code") BETWEEN 1 AND 32),
  "priority" INTEGER NOT NULL DEFAULT 100 CHECK("priority" BETWEEN 0 AND 1000),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK("version" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InventoryWarehouse_shopId_code_key" ON "InventoryWarehouse"("shopId", "code");
-- SQLite treats NULL shopIds as distinct, so platform codes need their own unique index.
CREATE UNIQUE INDEX "InventoryWarehouse_platform_code_key" ON "InventoryWarehouse"("code") WHERE "shopId" IS NULL;
CREATE INDEX "InventoryWarehouse_shopId_isActive_idx" ON "InventoryWarehouse"("shopId", "isActive");

CREATE TABLE "InventoryStock" (
  "id" TEXT NOT NULL PRIMARY KEY, "warehouseId" TEXT NOT NULL, "variantId" TEXT NOT NULL,
  "onHand" INTEGER NOT NULL DEFAULT 0, "reserved" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK("version" >= 0),
  "updatedAt" DATETIME NOT NULL,
  CHECK("reserved" >= 0 AND "reserved" <= "onHand" AND "onHand" <= 1000000000),
  FOREIGN KEY("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("variantId") REFERENCES "CatalogVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InventoryStock_warehouseId_variantId_key" ON "InventoryStock"("warehouseId", "variantId");
CREATE INDEX "InventoryStock_variantId_idx" ON "InventoryStock"("variantId");

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL PRIMARY KEY, "stockId" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK("type" IN ('RECEIPT','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','RESERVE','RELEASE','EXPIRE','SHIP')),
  "onHandDelta" INTEGER NOT NULL, "reservedDelta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL CHECK(length("reason") BETWEEN 1 AND 200),
  "actorUserId" TEXT, "reservationId" TEXT, "transferId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK("onHandDelta" <> 0 OR "reservedDelta" <> 0),
  FOREIGN KEY("stockId") REFERENCES "InventoryStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InventoryMovement_stockId_createdAt_idx" ON "InventoryMovement"("stockId", "createdAt");
CREATE INDEX "InventoryMovement_reservationId_idx" ON "InventoryMovement"("reservationId");

CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL PRIMARY KEY, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK("status" IN ('ACTIVE','ALLOCATED','SHIPPED','RELEASED','EXPIRED')),
  "expiresAt" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK("version" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CHECK("status" <> 'ACTIVE' OR "expiresAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "InventoryReservation_idempotencyKey_key" ON "InventoryReservation"("idempotencyKey");
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");

CREATE TABLE "InventoryReservationLine" (
  "id" TEXT NOT NULL PRIMARY KEY, "reservationId" TEXT NOT NULL, "stockId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL, "variantId" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK("position" >= 0),
  "quantity" INTEGER NOT NULL CHECK("quantity" > 0),
  "shippedAt" DATETIME,
  FOREIGN KEY("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InventoryReservationLine_reservationId_idx" ON "InventoryReservationLine"("reservationId");
