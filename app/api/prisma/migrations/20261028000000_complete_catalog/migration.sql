ALTER TABLE "CatalogCategory" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0);
ALTER TABLE "CatalogProduct" ADD COLUMN "images" JSONB NOT NULL DEFAULT '[]' CHECK (json_valid("images") AND json_type("images") = 'array');
ALTER TABLE "CatalogVariant" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}' CHECK (json_valid("attributes") AND json_type("attributes") = 'object');
ALTER TABLE "CatalogProduct" ADD COLUMN "minPriceAmount" INTEGER CHECK ("minPriceAmount" IS NULL OR ("minPriceAmount" >= 0 AND "minPriceAmount" <= 2147483647));

-- The price projection is rebuilt from durable active variants for old rows.
UPDATE "CatalogProduct"
SET "minPriceAmount" = (
  SELECT MIN("CatalogVariant"."priceAmount")
  FROM "CatalogVariant"
  WHERE "CatalogVariant"."productId" = "CatalogProduct"."id"
    AND "CatalogVariant"."isActive" = true
);

CREATE INDEX "CatalogProduct_status_minPriceAmount_createdAt_id_idx"
ON "CatalogProduct"("status", "minPriceAmount", "createdAt", "id");
