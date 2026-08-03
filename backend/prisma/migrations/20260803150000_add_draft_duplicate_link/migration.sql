-- Link a draft to an earlier one it may duplicate (BUSINESS_RULES §18).
--
-- Only message-level deduplication existed (on externalMessageId), which stops
-- the SAME webhook being processed twice. It does nothing for the far more
-- common case: an impatient customer who sends "2 shirts" twice because the
-- first message got no immediate reply. That produced two independent drafts
-- and, on approval, two real WooCommerce orders.
--
-- §18 requires potential duplicates to be flagged for owner review, NOT
-- auto-blocked — a customer genuinely ordering the same thing twice is a real
-- scenario, and silently swallowing the second order would lose a sale.
-- Pointing at the suspected original lets the owner compare and decide.
--
-- Nullable and self-referencing; existing rows are unaffected.
ALTER TABLE "ai_draft_orders" ADD COLUMN IF NOT EXISTS "duplicateOfId" UUID;

ALTER TABLE "ai_draft_orders"
  ADD CONSTRAINT "ai_draft_orders_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "ai_draft_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The detector queries recent drafts for one customer.
CREATE INDEX IF NOT EXISTS "ai_draft_orders_customer_created_idx"
  ON "ai_draft_orders" ("tenantId", "customerId", "createdAt" DESC);
