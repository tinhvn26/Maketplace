CREATE TABLE "OrderCheckout" (
  "id" TEXT NOT NULL PRIMARY KEY, "buyerId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 8 AND 100),
  "requestHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderCheckout_buyerId_idempotencyKey_key" ON "OrderCheckout"("buyerId", "idempotencyKey");

CREATE TABLE "Order" (
  "id" TEXT NOT NULL PRIMARY KEY, "checkoutId" TEXT NOT NULL, "buyerId" TEXT NOT NULL, "shopId" TEXT,
  "status" TEXT NOT NULL CHECK("status" IN ('PLACED','CONFIRMED','SHIPPED','DELIVERED','CANCELLED')),
  "reservationId" TEXT NOT NULL,
  "subtotalAmount" INTEGER NOT NULL CHECK("subtotalAmount" >= 0),
  "currency" TEXT NOT NULL DEFAULT 'VND' CHECK("currency" = 'VND'),
  "recipientName" TEXT NOT NULL CHECK(length(trim("recipientName")) BETWEEN 1 AND 100),
  "phoneNumber" TEXT NOT NULL,
  "addressLine" TEXT NOT NULL CHECK(length(trim("addressLine")) BETWEEN 5 AND 300),
  "note" TEXT CHECK("note" IS NULL OR length("note") <= 500),
  "cancelReason" TEXT CHECK("cancelReason" IS NULL OR length("cancelReason") <= 200),
  "cancelledBy" TEXT CHECK("cancelledBy" IS NULL OR "cancelledBy" IN ('BUYER','SELLER','ADMIN','SYSTEM')),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK("version" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  "confirmedAt" DATETIME, "shippedAt" DATETIME, "deliveredAt" DATETIME, "cancelledAt" DATETIME,
  CHECK(("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL)),
  FOREIGN KEY("checkoutId") REFERENCES "OrderCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Order_reservationId_key" ON "Order"("reservationId");
CREATE INDEX "Order_buyerId_createdAt_idx" ON "Order"("buyerId", "createdAt");
CREATE INDEX "Order_shopId_status_createdAt_idx" ON "Order"("shopId", "status", "createdAt");
CREATE INDEX "Order_checkoutId_idx" ON "Order"("checkoutId");

CREATE TABLE "OrderLine" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "variantId" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK("position" >= 0),
  "productId" TEXT NOT NULL, "productName" TEXT NOT NULL, "variantName" TEXT NOT NULL, "sku" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK("quantity" BETWEEN 1 AND 999),
  "unitPriceAmount" INTEGER NOT NULL CHECK("unitPriceAmount" >= 0),
  "lineTotalAmount" INTEGER NOT NULL,
  "productVersion" INTEGER NOT NULL,
  CHECK("lineTotalAmount" = "unitPriceAmount" * "quantity"),
  FOREIGN KEY("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("variantId") REFERENCES "CatalogVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderLine_orderId_variantId_key" ON "OrderLine"("orderId", "variantId");
CREATE UNIQUE INDEX "OrderLine_orderId_position_key" ON "OrderLine"("orderId", "position");
