-- Demand the catalog could not satisfy.
--
-- When the AI cannot match what a customer asked for, that is not just a
-- failed extraction — it is a customer telling the business, in their own
-- words, about a product they wanted to buy and could not. Until now that
-- signal was discarded with the failed match.
--
-- Aggregated, it answers a question no competitor in this space answers:
-- "what are people asking me for that I do not stock?"
CREATE TYPE "UnfulfilledReason" AS ENUM (
  'NO_CATALOG_MATCH',
  'EMPTY_CATALOG',
  'OUT_OF_STOCK'
);

CREATE TABLE "unfulfilled_demand" (
  "id"              UUID NOT NULL,
  "tenantId"        UUID NOT NULL,
  "customerId"      UUID,
  "messageId"       UUID,
  -- The customer's own words, kept for the owner to read.
  "query"           TEXT NOT NULL,
  -- Lowercased and whitespace-collapsed, so "Red Saree" and "red  saree"
  -- aggregate into one row in the report instead of two.
  "normalizedQuery" TEXT NOT NULL,
  "reason"          "UnfulfilledReason" NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "unfulfilled_demand_pkey" PRIMARY KEY ("id")
);

-- Every read is "this tenant, last N days, grouped by query".
CREATE INDEX "unfulfilled_demand_tenant_created_idx"
  ON "unfulfilled_demand" ("tenantId", "createdAt" DESC);
CREATE INDEX "unfulfilled_demand_tenant_query_idx"
  ON "unfulfilled_demand" ("tenantId", "normalizedQuery");

ALTER TABLE "unfulfilled_demand"
  ADD CONSTRAINT "unfulfilled_demand_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
