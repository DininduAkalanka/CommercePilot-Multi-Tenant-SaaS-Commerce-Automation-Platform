-- Indexes for the AI metrics read model.
--
-- Every metric is "for THIS tenant, over the last N days". The existing
-- indexes are `(tenantId)` alone on ai_processing_logs and `(tenantId, status)`
-- on ai_draft_orders — neither helps the time filter, so Postgres would read
-- every row a tenant has ever produced and discard most of them.
--
-- ai_processing_logs grows fastest in the whole schema: one row per pipeline
-- STAGE per message, so roughly 4-5 rows for every WhatsApp message received.
-- It is the table most in need of a composite index and the one where a
-- missing index hurts soonest.
--
-- Identifiers are quoted camelCase: @@map renames only the TABLE, so columns
-- keep their Prisma model field names.
CREATE INDEX IF NOT EXISTS "ai_processing_logs_tenant_created_idx"
  ON "ai_processing_logs" ("tenantId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ai_draft_orders_tenant_created_idx"
  ON "ai_draft_orders" ("tenantId", "createdAt" DESC);
