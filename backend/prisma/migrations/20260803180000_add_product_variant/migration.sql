-- Phase 1 PR1 (Expand) — per-variant stock.
--
-- PURELY ADDITIVE. A new table plus two nullable columns; nothing is migrated,
-- nothing existing changes behaviour, and no code reads these yet. Deploying
-- this changes nothing observable — it exists so the backfill (PR2) and the
-- read switch (PR3) have somewhere to land.
--
-- WHY THIS TABLE IS NEEDED
-- `products.stockQuantity` is a single integer and `products.attributes` lists
-- which options exist without attaching stock to any of them. The catalog can
-- say "this shirt has 12 units" but never "blue in L has 3". Answering that
-- question wrongly is worse than not answering: it promises stock that cannot
-- ship, which is exactly the trust failure the human-approval design exists to
-- prevent.
--
-- On CREATE INDEX locking: `products` and `ai_draft_order_items` are small
-- here, and ADD COLUMN of a nullable column with no default is metadata-only
-- in Postgres 11+, so no table rewrite occurs.
CREATE TABLE "product_variants" (
  "id"            UUID NOT NULL,
  "tenantId"      UUID NOT NULL,
  "productId"     UUID NOT NULL,
  -- Chosen options, e.g. {"size":"L","color":"blue"}. Empty for the default
  -- variant of a simple product.
  "attributes"    JSONB NOT NULL,
  -- Canonical, sorted, lowercased form ("color=blue|size=l"). Exists so the
  -- DATABASE can guarantee one product never has two variants for the same
  -- combination — raw JSON could not, because key order and casing differ
  -- between WooCommerce, the dashboard and the AI extractor.
  "attributeKey"  TEXT NOT NULL,
  "sku"           TEXT,
  -- NULL means "inherit the product price", not "free".
  "price"         DECIMAL(12,2),
  "stockQuantity" INTEGER NOT NULL DEFAULT 0,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  -- WooCommerce *variation* id, not a product id.
  "woocommerceId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "deletedAt"     TIMESTAMP(3),

  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- One variant per combination, enforced by the database rather than by hoping
-- every write path remembers to check.
CREATE UNIQUE INDEX "product_variants_productId_attributeKey_key"
  ON "product_variants" ("productId", "attributeKey");

CREATE INDEX "product_variants_tenantId_productId_idx"
  ON "product_variants" ("tenantId", "productId");
CREATE INDEX "product_variants_productId_isActive_idx"
  ON "product_variants" ("productId", "isActive");
CREATE INDEX "product_variants_tenantId_sku_idx"
  ON "product_variants" ("tenantId", "sku");

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cascade: a deleted product's variants have no meaning on their own.
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable on purpose: historical rows predate variants and must keep working
-- untouched. PR3 starts populating them.
ALTER TABLE "order_items"          ADD COLUMN IF NOT EXISTS "variantId" UUID;
ALTER TABLE "ai_draft_order_items" ADD COLUMN IF NOT EXISTS "variantId" UUID;
