cls
# Changelog

All notable changes to CommercePilot are documented here.
Format follows a phase-based release model.

## [Phase 8] — Frontend Completion & E2E

Live-audited every dashboard page against the running backend (screenshots +
console/network inspection via Playwright), fixed every defect found, and
added a permanent Playwright E2E suite so these regressions can't return
silently.

### Fixed — frontend/backend contract bugs
- **Dashboard home KPIs read the wrong field names.** `orders.getStats()`
  returns `{ totalOrders, pendingApproval, approvedToday }`; the dashboard read
  `stats.total` / `.pending` / `.approved` (always `undefined` → silently
  showed 0). Also removed a **hardcoded fake "94% AI Accuracy"** value and a
  "Total Revenue" that had no backing field at all — both now come from the
  already-correct `/orders/analytics` endpoint.
- **Notifications page showed "No notifications" while its own header said
  "4 total notifications."** The list read `data.notifications`; the backend
  returns `data.items`. Fixed the field name.
- **EMAIL notifications rendered raw HTML markup as literal text** in the
  notification feed (`<h2>`, `<p>`, `<a href=...>` visible verbatim). The
  service was storing the full HTML email body in `message` (meant to be a
  plain-text summary). Added `htmlToPlainText()` so `message` is always
  human-readable, regardless of channel.
- **Customer Detail page was completely broken** (`/dashboard/customers/[id]`):
  every request went to `/customers/undefined`, cascading 500s on every field.
  Root cause: Next.js 16 removed synchronous `params` access
  (`{ params }: { params: { id: string } }`); this page still destructured
  `params.id` directly instead of using `useParams()` like its sibling
  `orders/[id]` page. Converted to `useParams()` for consistency; verified
  live (zero console errors, zero failed requests) and with a dedicated
  Playwright regression test.
- **Draft correction workflow was fundamentally broken.** `saveDraftCorrections`
  was meant to replace a draft's line items after an owner correction, but only
  bumped `updatedAt` on the old `AIDraftOrderItem` rows (the code comment said
  "soft-delete" — the model has no `deletedAt` field, so this was a no-op) and
  then *added* new corrected items alongside them. `approveDraft()` includes
  **all** items for the draft, so it validated the stale, AI-matched item too
  and rejected the order ("Product not found: <original bad id>") — meaning
  correcting a mismatched AI draft and approving it **always failed**. Fixed by
  actually deleting the superseded items before creating the corrected ones;
  the correction audit trail is unaffected (it lives in the immutable
  `AuditLog` entry + `AIDraftOrder.humanCorrections`, not in the item rows).
  Found by the new order-flow E2E test — never caught by unit tests, since
  those mock a single call rather than the full correct→approve sequence.

### Fixed — security
- **SSE endpoint accepted a JWT via `?token=` query string**, a direct,
  explicit violation of this project's own `API_GUIDELINES.md §15` /
  `SECURITY.md` ("never accept authentication in query parameters") —
  present only because the native browser `EventSource` API cannot send
  custom headers. Replaced with a `fetch`-based SSE client
  (`frontend/src/lib/sse.ts`) that sends the JWT as a normal
  `Authorization: Bearer` header, and removed the query-param extractor from
  `JwtStrategy` (header-only again). Verified live: header auth → 200
  `text/event-stream`; query-param-only auth → 401.

### Fixed — accessibility
- WhatsApp Simulator's send button was icon-only with no accessible name;
  added `aria-label="Send message"`.

### Added
- **Playwright E2E suite** (`frontend/e2e/`, `frontend/playwright.config.ts`):
  `auth.spec.ts` (register → dashboard → logout → login; invalid-credentials
  error path), `order-flow.spec.ts` (the PRD success-criterion flow: simulator
  message → AI draft → owner correction → approval → synced order),
  `regression.spec.ts` (pins down the four bugs above so they can't silently
  return). Each test registers its own throwaway tenant via the API
  (MOCK providers by default) — hermetic, no shared state, no external
  services required. `npm run test:e2e` to run. **7/7 passing.**
- Backend regression test for the draft-correction fix (asserts the old items
  are actually deleted, and deleted *before* the corrected ones are created).

### Verified live (manual + automated)
- Full page audit: Dashboard, Orders (list/detail/correction), Products (full
  CRUD round-trip: create → edit → delete), Customers (list/detail),
  WhatsApp Simulator, Notifications, Analytics, Settings, Login, Register —
  all render correctly against the real running backend with zero console
  errors and zero failed requests (post-fix).
- Backend: `tsc --noEmit` clean, `nest build` clean, **114/114 tests, 18
  suites**. Frontend: `tsc --noEmit` clean, `next build` (production) clean
  across all 14 routes including the previously-broken dynamic route.

### Known follow-ups (unchanged from earlier phases, not addressed here)
- `RegisterDto` password policy still weaker than SECURITY §14 (deferred to
  the Security Hardening phase).
- Real Gemini AI extraction still blocked on Google billing/region for this
  account; mock mode's canned response is why the E2E test exercises the
  owner-correction path rather than assuming a lucky AI match — this is by
  design given the current environment, not a gap in the test.

## [Phase 7] — Live Integration Verification (WooCommerce)

Stood up the full stack (Postgres + Redis + MailHog via Docker) and ran the
complete order pipeline against a **real WooCommerce store**, end to end.

### Verified live
- Migration baseline applied to a real database (baselined an existing `db push` DB).
- Restricted credentials stored **encrypted** (`v1:` AES-256-GCM envelope) via the
  Settings API — confirmed by direct DB inspection.
- **Product sync**: 4 products pulled from the live store into CommercePilot with
  their `woocommerceId` mapping.
- **Full flow**: WhatsApp simulator message → AI draft → owner approval →
  `order.approved` event → OrderSyncService → **real WooCommerce orders created**
  (store orders #19 and #20), with `woocommerceOrderId` + `syncedAt` persisted.

### Fixed (found by the live run)
- **Double inventory decrement.** Stock was being deducted twice — once on
  approval (`orders.service`) and once on sync (`order-sync.service`, added in
  Phase 5) — so a 2-unit order reduced stock by 4. Per BR-14 ("inventory is never
  reduced until the order is approved **and** synchronized"), removed the premature
  decrement from the approval path; stock is now reduced exactly once, on
  successful sync (and not at all if sync fails). Re-verified live: a 3-unit order
  now reduces stock by exactly 3 with exactly one `InventoryTransaction`.
  Stock **validation** on approval is retained.

### Notes
- AI ran in **mock mode** (no `GEMINI_API_KEY`); mock extraction is low-quality and
  hallucinated a product id (correctly rejected by approval validation as
  "Product not found"). A real Gemini key is required for accurate extraction.
- Test WooCommerce orders #18–#20 were created during verification and can be deleted.

## [Phase 6] — Architectural Completeness

Closes the missing backend modules from `SYSTEM_ARCHITECTURE §4` (Users, Audit
Logs, platform Admin) and wires the previously-orphaned audit writer. Every new
endpoint enforces JWT auth, RBAC, tenant isolation, input validation, standard
response envelopes, and Swagger docs.

### Added
- **Users module** (`modules/users/`) — OWNER-operated team management:
  `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`,
  `DELETE /users/:id` (soft delete). Business-safety guards:
  - No privilege escalation — `SUPER_ADMIN` can never be assigned via the tenant API.
  - The tenant's **last active OWNER** cannot be demoted, deactivated, or removed.
  - An owner cannot deactivate/delete **their own** account (self-lockout).
  - Passwords enforce SECURITY §14 (≥12 chars, upper/lower/number/special),
    are bcrypt-hashed, and responses never expose `passwordHash`/`refreshTokenHash`.
  - All mutations recorded to the audit trail.
- **Audit Logs module** (`modules/audit-logs/`) — read-only query API over the
  immutable trail (PRD US-005): `GET /audit-logs` (paginated + filter by
  entityType/entityId/action/actorUserId) and `GET /audit-logs/:entityType/:entityId`.
  OWNER-restricted, tenant-scoped.
- **Admin module** (`modules/admin/`) — SUPER_ADMIN platform operations, the only
  cross-tenant surface: `GET /admin/tenants` (paginated + search),
  `GET /admin/stats`, `PATCH /admin/tenants/:id/status` (activate/suspend).
  Tenant credentials are never selected/exposed; status changes are audit-logged.
- New tests for all three services (tenant-scoping, RBAC-relevant guards,
  privilege-escalation/last-owner/self-lockout, credential-exclusion, pagination).
  Suite: **112 tests / 18 suites green** (was 92).

### Changed / Fixed
- **Wired the orphaned `AuditLogService`** into the global `CommonModule`
  (provided + exported), so any module can record immutable audit events.
- Swagger now documents the new **Users / Audit Logs / Admin** tag groups.

### Known follow-ups (out of scope this phase)
- `RegisterDto` still uses `@MinLength(8)` — weaker than SECURITY §14 (≥12 +
  complexity). New staff creation enforces the strong policy; aligning the
  self-service register flow is a small, separate change (may affect existing accounts).
- No SUPER_ADMIN seeding mechanism yet — the platform-admin account must be
  provisioned manually/by seed.
- Live WooCommerce end-to-end verification still pending real store credentials.


## [Phase 5] — Production Foundations & Real Integration Enablement

Converts the mock-rails MVP toward the documented end-to-end success criterion
(WhatsApp → AI → owner approval → WooCommerce → customer confirmation) by
establishing production foundations and real integration adapters.

### Added
- **Prisma migration baseline** (`backend/prisma/migrations/00000000000000_init`)
  generated from the current schema (pgvector + uuid-ossp extensions, all
  tables/enums/indexes). Replaces `db push` with a versioned migration history.
- **`EncryptionService`** (AES-256-GCM, `backend/src/common/services/`) for
  application-layer encryption of *Restricted* data at rest, provided by a new
  global `CommonModule`. Versioned envelope (`v1:iv:tag:ciphertext`) supports
  future key rotation; decrypt is backward-compatible with legacy plaintext.
- **`MetaWhatsAppAdapter`** — real WhatsApp Cloud API (Graph) adapter behind
  `IWhatsAppAdapter`, activated by `WHATSAPP_PROVIDER=meta`. Simulator/mock
  remains the default. (Unit-tested with mocked `fetch`.)
- **Order idempotency** — `CreateOrderPayload.idempotencyKey` (stable per order)
  is persisted to the WooCommerce order `meta_data`, preventing duplicate
  external orders on retries (BR-15 / BR-18).
- **Inventory on sync** — approved+synced orders now write an `OUT`
  `InventoryTransaction` per line item and decrement product stock in the same
  transaction (BR-14: stock reduced only after approval and successful sync).
- New tests: encryption round-trip/tamper/fail-secure, WooCommerce adapter
  tenant-isolation + mock idempotency, order-sync idempotency/inventory/failure,
  Meta adapter send/error paths, tenant-settings credential encryption.
  Suite: **92 tests / 15 suites green** (was 66).

### Changed / Fixed
- **Fixed cross-tenant leak risk in `WooCommerceAdapter`**: was a stateful
  singleton storing per-tenant connection (`api`/`isMock`) on instance fields —
  concurrent tenants could clobber each other's client. Refactored to a
  **stateless per-tenant client** (`IEcommerceAdapter.initialize()` returns an
  `EcommerceClient` passed explicitly to `getProducts`/`createOrder`).
- `TenantSettingsService` now **encrypts** `whatsappAccessToken`,
  `whatsappVerifyToken`, `woocommerceKey`, `woocommerceSecret` before persistence.
- `OrderSyncService` now persists `woocommerceOrderId` + `syncedAt` on success
  and validates external product mapping before syncing to a real store.
- Removed `any` from the integrations adapters/services (strict typing).

### Ops / Config
- New required env var **`ENCRYPTION_KEY`** (64 hex chars — `openssl rand -hex 32`).
  See `backend/.env.example`. Rotating it makes existing ciphertext undecryptable.

### Known follow-ups (out of scope this phase)
- WooCommerce product fetch paginates only the first 100 (logged when truncated).
- Meta adapter uses env-level credentials; per-tenant WhatsApp send is a later refactor.
- `AuditLogService` in `common/` is not yet wired into a module.
