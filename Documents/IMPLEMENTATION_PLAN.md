# CommercePilot — Implementation Plan

> **Living document.** Update the checkboxes as work lands. Everything needed
> to stop and resume without re-deriving context is in here.

**Last updated:** 2026-08-03 · **`main` at:** `0e70707`

---

## 1. Status at a glance

| Phase | Status |
|---|---|
| **Pre-work** — audit remediation | ✅ Complete · merged · live |
| **Phase 0** — Instrument & measure | ✅ Complete · merged · live |
| **Phase 1** — `ProductVariant` | 🟡 PR1 merged · PR2+PR3 built · PR4 remains |
| **Phase 2** — Stop losing orders | 🟡 4 of 6 merged · 2.5 / 2.6 remain |
| **Phase 3** — Sinhala / Singlish | 🟡 Query normalisation merged · tuning blocked on eval dataset |
| **Phase 4** — Voice & images | ⬜ Not started |
| **Phase 5** — Scale out | ⬜ Trigger-based — no trigger fired yet |
| **Phase 6** — Payments & courier | ⬜ Not started |

**Tests:** 180 unit · 13 E2E · lint 0 errors · tsc clean · builds clean.

---

## 2. ⚠️ Read this first — the product is not plugged in

The codebase is correct and deployable. It is **not connected to reality**.
These are configuration/account gaps, not code, and most other work is
unverifiable until they are closed.

| # | Blocker | Effect | Owner |
|---|---|---|---|
| 1 | **`GEMINI_API_KEY` unset** | The AI runs on a **canned mock**. Metrics measure the mock. The eval harness scores the mock. **You cannot know if the product works.** | You (free tier, Google AI Studio) |
| 2 | **`WHATSAPP_PROVIDER=mock`** | No real customer can reach the system. Simulator only. | You (Meta setup) |
| 3 | **`products.embedding` all NULL** | Vector search degrades to text search. The old broken UPDATE never wrote one. Needs a backfill command (~2h, pointless before #1). | Dev, after #1 |
| 4 | **`EMAIL_PROVIDER=mailhog`, no SMTP in prod** | Owner emails are recorded as `Notification` rows but **never delivered**. The human-handoff feature depends on this. | You (Resend) |

**Do #1 and #4 first.** They're an hour of account setup and they unlock
everything that currently cannot be measured.

---

## 3. Phases

### ✅ Pre-work — audit remediation (complete, live)

Found by a full audit on 2026-08-02. All fixed, merged and deployed.

- [x] CI pipeline — lint ran `--fix`, so CI judged code it had rewritten and
      still failed. `deploy-backend` needs both CI jobs, so **the deploy hook
      never fired**. `lint` is now read-only; `lint:fix` is separate.
- [x] Deploy chain — three independent breaks left production frozen on
      `9c62861` for 26 days. See §5 for all three.
- [x] Rate limiting — `ThrottlerModule` configured but no `APP_GUARD`, so it
      was **inert**. Login was unmetered. Verified live: 25 rapid logins, zero 429s.
- [x] Cross-tenant leak — mock AI opened its own `PrismaClient` and ran an
      unfiltered `product.findMany()`. Live, because prod runs mock mode.
- [x] Cross-tenant leak — `saveDraftCorrections` looked up products with no
      tenant filter, using a body-supplied id.
- [x] Webhook HMAC — signed `JSON.stringify(payload)` instead of raw bytes.
      Would have **silently dropped every real order** on go-live.
- [x] **Vector search was dead from day one** — see §5.
- [x] Random embeddings poisoning the index permanently on any API error.
- [x] RAG text fallback matched whole sentences; effectively never hit.
- [x] Draft correction returned 400 on string `unitPrice` (regression I
      introduced, caught by E2E).
- [x] Swagger public in prod · password policy §14 · non-root container ·
      §10 confidence bands · validated simulator DTO · `test.py` removed.

### ✅ Phase 0 — Instrument & measure (complete, live)

- [x] **HNSW index** on `products.embedding` — 0.99ms vs 8.73ms on 3k products
- [x] **§10 confidence bands** as named constants; tenant threshold clamped so
      it can only tighten, never loosen
- [x] **Sentry** — 5xx only, `sendDefaultPii: false`, `beforeSend` strips
      bodies/headers/cookies/query strings
- [x] **AI metrics** — `GET /api/v1/ai-engine/metrics`, `/dashboard/ai-performance`
- [x] **E2E suite run** — 13/13
- [x] **Eval harness** — `npm run eval`, `backend/eval/`
- [ ] **Eval dataset — 50+ real customer messages** ← **only you can supply**
      See `backend/eval/README.md`: export WhatsApp chats, anonymise phone
      numbers and addresses per SECURITY.md §3, match your real language mix.


### ✅ Unplanned — AI provider migration (merged, live)

Not in the original plan. Forced by Gemini's free tier being region-gated:
a key created in Sri Lanka lists every model and then fails the first real
call with `limit: 0, metric: generate_content_free_tier_requests`. The
allocation is zero, not exhausted, and lifting it needs a card.

- **`AiAdapter` interface + `AI_ADAPTER` token** — five services injected the
  concrete `GeminiAdapter`, so there was nothing to swap. `AI_PROVIDER`
  selects at startup; switching back is an env change, not a deploy.
- **`GroqAdapter`** — free tier serves Sri Lanka, ~200-400ms, valid JSON.
  Order extraction works; Sinhala colour accuracy is unreliable, which the
  0.95 auto-approve floor is what protects against.
- **`EmbeddingProvider` split** — embeddings and text generation come from
  different vendors now, and Groq has no embedding models at all.
- **`JinaEmbeddingProvider`** — emits 768 dims so `vector(768)` and its HNSW
  index are untouched. ⚠️ **The key currently has zero balance**
  (`AUTHZ_INSUFFICIENT_BALANCE`), so `EMBEDDING_PROVIDER` falls back to
  `none` and retrieval uses text search. Not blocking.
- **Removed** `GeminiAdapter.generateEmbedding` — it targeted
  `text-embedding-004`, which the API now 404s.

**Measured, so it is not re-litigated later:** Jina handles English and
Singlish well (Singlish→English 0.628, margin 0.322). Sinhala *script* does
not work — every Sinhala query ranked the same unrelated product first,
margins 0.005-0.035. Shorter product text did not help and the asymmetric
`retrieval.*` tasks were worse. Query normalisation is what fixes it.

### ✅ Unplanned — query normalisation (merged, live)

Fixed a **total** failure, not a marginal one. Text search tokenises on
`[^a-z0-9]`, so Sinhala yielded ZERO search terms and matched nothing;
combined with no embedding provider, Sinhala customers got no products at
all. Normalising to English before retrieval took vector margins from 0.010
to 0.421 and text terms from 0 to 2. Retrieval only — extraction still
receives the original message, guarded by a mutation-tested invariant.
`QUERY_NORMALIZATION_ENABLED=false` reverts without a deploy.

### 🟡 Phase 1 — `ProductVariant` (PR1 done, PR2–PR4 pending)

> **Launch prerequisite.** Must land **before** `WHATSAPP_PROVIDER` comes off
> mock. Once real stock is moving, this migration needs a maintenance window
> and stock reconciliation.

**Why:** `Product.stockQuantity` is one integer; `attributes` is a list of
options with no stock attached. The system cannot answer *"is blue available
in L?"* — and answering wrongly promises stock you cannot ship.

Also broken today: `getProducts()` never fetches Woo variations, and order
line items send no `variation_id`, so variable-product orders reach
WooCommerce with no size/colour.

**Ship as 4 PRs (expand/contract). Nothing destructive at any step:**

- [x] **PR1 Expand** — add `ProductVariant` + nullable `variantId` on
      `OrderItem`/`AIDraftOrderItem`. Nothing reads them. *Risk: none.*
      **Done** — branch `feat/product-variant-expand`, commit `105ea94`.
      Migration `20260803180000_add_product_variant`, `ProductVariantService`
      (23 tests, written first), suite 210 → 233.
      Variants are keyed by a canonical `attributeKey` (`color=blue|size=l`)
      with `@@unique([productId, attributeKey])`, so the **database** rejects
      duplicate combinations rather than each write path remembering to check.
      Verified on `pgvector/pg16`: unique index rejects a colliding
      combination, product FK cascades, image migrates and boots clean.
- [x] **PR2 Backfill + dual-write** — one default variant per product carrying
      current stock; write stock to both. *Risk: low.*
      **Built** — branch `feat/product-variant-backfill`.
      `npm run backfill:variants [tenantId]` — idempotent, selects only
      products with NO variants, so re-running reconciles without touching
      products that already have real size/colour variants.
      Dual-write wired into all five stock write paths: product create,
      product update, WooCommerce sync create, WooCommerce sync update, and
      the order-sync decrement. The decrement joins the caller's
      **transaction** — verified on a live database that a rolled-back sync
      leaves product and variant still agreeing.
      Mirror failures never throw into the caller: a stale mirror is repaired
      by re-running the backfill, a lost order is not. Suite 311 → 327.
- [x] **PR3 Switch reads** behind `VARIANT_STOCK_ENABLED` — `validateStock`,
      RAG context, order-sync decrement. *Risk: medium; flag off reverts instantly.*
      **Built** — branch `feat/variant-stock-reads`. Default OFF.
      Three read paths switched: order `validateStock`, the AI conflict
      resolver, and the RAG catalogue context. All three share one resolver so
      they cannot disagree — the AI promising stock that validation then
      rejects would be worse than either alone.
      Falls back to product stock on ANY doubt: flag off, no variant row, or a
      failed lookup. A genuine zero still reports zero, which is the point.
      Verified live: flag off → 12 (unchanged), flag on → 3 (variant), and a
      product with no mirror → 44 (fallback, not 0).
      ⚠️ **Run `npm run backfill:variants` in production BEFORE enabling.**
      `ProductVariantService` moved into its own `ProductVariantModule`:
      `ProductsModule` imports `AiEngineModule`, so `AiEngineModule` importing
      products back would have been a dependency cycle. Unit tests passed
      regardless — only a container boot caught it.
- [ ] **PR4 Contract** — `Product.stockQuantity` becomes a maintained rollup.
      *Do this days after PR3.*
- [ ] **WooCommerce** — fetch variations (N+1, only for `type === 'variable'`,
      run in BullMQ), send `variation_id` on line items, add pagination
      (`getProducts` only fetches page 1 today and logs a warning about it)

**Decisions already made:** every product gets ≥1 variant (one code path);
`Product.stockQuantity` becomes a rollup; sync Woo variations in the same
effort; 4 PRs not 1.

**⚠️ Watch:** RAG prompt bloat. 5 products × 12 variants = 60 blocks instead
of 5 — burns free-tier tokens and can *degrade* extraction silently. Use a
compact availability line from the start:
`In stock: S(4) M(0) L(7) XL(2) · blue, navy`.
Measure with the eval harness before and after.

**Estimate:** ~4 days.

### 🟡 Phase 2 — Stop losing orders (3 of 6, merged, live)

- [x] **2.1 Meta `referral` capture** — the ad/post the customer tapped names
      the product before they type. Headline+body feed retrieval. Zero config.
- [x] **2.2 Human escape hatch** — after 2 failed clarifications the AI stops
      asking, tells the customer a person will reply, and notifies the owner.
      `HANDOFF_ENABLED=false` restores old behaviour with no deploy.
- [x] **2.3 `UnfulfilledDemand`** — every unmatched request logged. Report at
      `GET /api/v1/ai-engine/unfulfilled-demand`, ranked by *distinct customers*.
- [ ] **2.4 Duplicate detection (§18)** — **built, awaiting your merge**:
      branch `feat/duplicate-detection`, commit `2d42a50`. Only message-level
      dedup existed (`externalMessageId`); an impatient customer sending
      "2 shirts" twice creates **two real WooCommerce orders**. Now checks
      customer + product + qty within N minutes → flags `POTENTIAL_DUPLICATE`
      for review rather than auto-blocking.
- [ ] **2.5 Soft alternatives** — acknowledge the miss honestly, then offer
      2–3 close matches. Not a catalogue dump.
- [ ] **2.6 Friendly tone prompts** — warm, customer's language, no robotic
      phrasing. **Never claim to be human** — the handoff has to stay honest.

### ⬜ Phase 3 — Sinhala / Singlish (blocked)

> **Gated by the Phase 0 eval dataset. Do not start without it.**

The biggest *market-fit* risk. Prompts are English-only; the market writes
Sinhala script, Singlish (`"mata blue shirt 2k denna"`) and code-mixed.

- [ ] Baseline the eval set, record accuracy per language
- [ ] Sinhala script — remove English assumptions from prompts
- [ ] Singlish — 50–100 few-shot examples + transliteration normaliser
- [ ] Reply in the customer's language
- [ ] Re-measure after each change; ship only what moves the number

**Exit:** ≥90% extraction accuracy on the Singlish slice.

### ⬜ Phase 4 — Voice & images

- [ ] **Voice notes** (~3 days) — Gemini audio/Whisper → transcript → existing
      pipeline. Arguably more common than typing in this market. **Do first.**
- [ ] **Images** (~1 week) — Gemini Vision → description → embedding → match.
      Only covers what 2.1 `referral` misses (screenshots, forwarded photos).

`processMessage` currently skips anything that isn't `TEXT`.

### ⬜ Phase 5 — Scale out (trigger-based, do NOT schedule)

One free instance is the correct architecture for current load. Build each
item only when its trigger fires.

| Trigger | Action |
|---|---|
| Need a 2nd instance | **Redis pub/sub for SSE + `ThrottlerStorageRedisService`.** Both are in-memory — they break **silently** with 2 instances: live dashboard updates stop for some users, rate limits become 5×N. **Fix before the 2nd instance, not after.** |
| Queue backing up / AI starving HTTP | Split the BullMQ worker into its own service |
| Approaching 15 req/min on Gemini | Paid tier + per-tenant quota |
| Running >1 instance | Neon pooled `DATABASE_URL` + `directUrl` for migrations |
| >10k products/tenant | Tune HNSW; cache hot catalogue |

### ⬜ Phase 6 — Payments & courier

- [ ] Payment link on approval (PayHere/Genie)
- [ ] Courier dispatch + tracking
- [ ] **Onboarding-as-a-service** — Meta API setup is the #1 funnel leak.
      Sell setup, or become/partner with a BSP. *Business decision.*

---

## 4. Other known gaps (not in a phase)

- [ ] `PATCH /notifications/:id/read` is a **no-op** — schema has no read
      column. Route honestly returns `persisted: false`. Needs `readAt` + migration.
- [ ] **JWT in `localStorage`** — XSS-exfiltratable. Fix is httpOnly refresh
      cookie + in-memory access token: coordinated FE+BE change, real
      regression risk. Deferred deliberately.
- [ ] **CodeQL disabled** — code scanning needs GitHub Advanced Security on
      *private* repos. Re-enable by restoring triggers in
      `.github/workflows/codeql.yml` if the repo goes public.
- [ ] **`AIDraftOrder.humanCorrections` is unused** — every owner edit is
      labelled truth (AI output vs reality). Mine it to improve prompts.
      Respect BUSINESS_RULES §24: no cross-tenant training.
- [ ] Verify `TRUST_PROXY_HOPS` (default 1) against Cloudflare→Render.
      Confirmed working 2026-08-02: counter accumulates per client, 429 fires.

---

## 5. Hard-won gotchas — do not re-derive these

**Raw SQL must quote camelCase identifiers.**
`@@map` renames only the TABLE. Columns keep Prisma model field names, so
Postgres has `"tenantId"`, `"isActive"`, `"deletedAt"`, `"stockQuantity"`.
Using snake_case threw on every call, `retrieve()` caught it, and **vector
search silently never ran** — with nothing but a warning log. Unit tests mock
Prisma and cannot catch this; the spec now asserts on query text.

**`eslint --fix` strips load-bearing `as object` casts.** It broke the build
twice by removing casts Prisma's `InputJsonValue` needs. Use
`as Prisma.InputJsonValue` — a meaningful assertion autofix won't remove.
This is why CI lint is read-only.

**`eval/` must stay in `tsconfig.build.json` `exclude`.** Including it widens
tsc's inferred `rootDir` to the project root, moving the entrypoint to
`dist/src/main.js` and breaking `node dist/main` in the container.

**Named throttlers in `forRoot` apply to EVERY route.** Per-route limits must
override an existing bucket with `@Throttle`, not add a new named one.

**Neon: use the DIRECT connection string**, not `-pooler`. Prisma Migrate
takes a session-scoped advisory lock; a transaction-mode pooler cannot hold
it, and an orphaned lock then blocks later attempts too. Neon free tier also
scales to zero — the entrypoint retries `migrate deploy` 5× to span the cold
start. Production runs **pgvector 0.8.1**.

**The 26-day outage had three independent causes**, each hiding the next:
① CI red → deploy job skipped; ② Render's GitHub App uninstalled →
"unable to access your GitHub repository"; ③ pooled `DATABASE_URL` + cold
Neon → `P1002`.

**E2E: bot replies are not queryable.** `addBotReply` only appends to the
Redis session. Assert on the owner `Notification` instead.

**Ports 3000/3001/5433/6379** collide with the separate `textile_*` docker
stack (`Desktop\Nandana Textile\...`). Stop those before running E2E.

---

## 6. Commands

```bash
# stack
docker compose up -d                 # postgres 5433, redis 6379, mailhog 8025
cd backend && npx prisma migrate deploy
cd backend && node dist/main         # or npm run start:dev

# checks
cd backend  && npm run lint && npx tsc --noEmit && npm run build && npm test
cd frontend && npm run lint && npx tsc --noEmit && npm run build
cd frontend && npx playwright test   # needs backend on :3001

# extraction accuracy (needs GEMINI_API_KEY to mean anything)
cd backend && npm run eval
cd backend && npm run eval -- --limit 5 --verbose
```

**Env worth knowing:** `HANDOFF_ENABLED`, `HANDOFF_MAX_CLARIFICATIONS` (2),
`AUTH_RATE_LIMIT` (5), `AUTH_RATE_TTL_MS`, `TRUST_PROXY_HOPS` (1),
`RAG_MIN_SIMILARITY` (0.5), `MIGRATE_ATTEMPTS` (5), `SWAGGER_ENABLED`,
`SENTRY_DSN`.

> `AUTH_RATE_LIMIT` and friends are read at decorator time, so they must be
> **real environment variables** — a `.env` entry alone will not apply.

---

## 7. Recommended order from here

0. **Set `GROQ_API_KEY` + `AI_PROVIDER=groq` in Render.** Until then
   production runs the mock and none of the AI work above is live. This is
   the single change that switches the AI on for real customers, so
   immediately after: run `npm run eval` for a first real accuracy number,
   and confirm `autoApproveEnabled` is false per tenant against the live
   database rather than trusting the default.
1. ~~Get `GEMINI_API_KEY`~~ — **abandoned**, region-gated. Groq replaces it
2. **Set up Resend** — owner emails currently never arrive
3. **Embedding backfill** (dev, after #1), then run `npm run eval` for a first
   real accuracy number
4. **Finish Phase 2** — 2.5/2.6 (~1 day)
5. **Phase 1 PR3–PR4** — switch reads behind `VARIANT_STOCK_ENABLED`, then
   contract. Run `npm run backfill:variants` in production FIRST and confirm
   the mirror is complete before PR3 makes anything read it (~2 days)
6. **Collect 50 eval messages**, then Phase 3
