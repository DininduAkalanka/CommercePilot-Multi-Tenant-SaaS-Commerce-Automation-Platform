# CommercePilot — QA Report

**Date:** 4 August 2026
**Commit under test:** `0b082ba` (`main`)
**Environments:** local (Docker Postgres 16 + pgvector, Redis 7), production (Render + Neon + Vercel)

Everything below was executed and observed. Nothing is estimated or assumed;
where something could not be verified, it says so.

---

## 1. Verdict

**The system passes functional QA and is safe to run in its current state.**

Every automated test passes, tenant isolation holds under direct attack,
migrations apply cleanly to an empty database, and the deploy artifact boots.

**It is not ready for paying customers**, for one reason that is not a defect
in the code: the AI provider's free tier caps the entire platform at roughly
30 customer messages per day. Detail in §8.

| Area | Result |
|---|---|
| Backend unit tests | ✅ 369 / 369 |
| End-to-end tests | ✅ 18 / 18 (twice consecutively) |
| TypeScript (both apps) | ✅ 0 errors |
| ESLint (both apps) | ✅ 0 errors |
| Database migrations | ✅ 7 applied, no pending |
| Schema drift | ✅ 1 known, unavoidable |
| Tenant isolation | ✅ 5 / 5 attacks blocked |
| Auth & input validation | ✅ 6 / 6 |
| Container boot | ✅ clean |
| Production endpoints | ✅ all correct |
| **Capacity for real traffic** | ❌ **~30 messages/day ceiling** |

---

## 2. Automated tests

### Backend — 369 passed, 35 suites, 0 failed

Coverage, whole codebase:

| Metric | Coverage |
|---|---|
| Statements | 52.93% (1621 / 3062) |
| Branches | 50.47% (855 / 1694) |
| Functions | 56.32% (276 / 490) |
| Lines | 52.71% (1477 / 2802) |

A single overall figure is misleading here, because coverage is concentrated
exactly where the risk is:

| Module | Statements | Why it matters |
|---|---|---|
| `integrations/services` | **96.77%** | Pushes real orders to WooCommerce |
| `ai-engine/adapters` | **80.86%** | Provider calls, retries, mock fallback |
| `ai-engine` | **78.18%** | Draft creation, duplicate detection |
| `products` | **77.48%** | Stock, variants |
| `orders` | 57.82% | Order lifecycle |
| `ai-engine/pipeline` | 60.08% | Intent, retrieval, extraction |
| `auth` | 33.66% | ⚠️ see §7 |
| `notifications` | 29.82% | ⚠️ see §7 |
| `common/interceptors`, `filters`, `observability` | **0%** | ⚠️ see §7 |

### End-to-end — 18 passed, 0 failed

Run twice consecutively with identical results.

| Suite | Tests | Covers |
|---|---|---|
| `order-flow` | 1 | message → AI draft → owner edit → approval → WooCommerce sync |
| `human-handoff` | 3 | escalation after repeated failures, notify-once, no false escalation |
| `regression` | 4 | Next.js async-params, dashboard KPIs, notification counts, JWT never in URL |
| `ai-performance` | 3 | empty state, real activity, endpoint requires a token |
| `auth` | 2 | register → dashboard → logout → login; invalid credentials |
| `responsive-audit` | 5 | overflow at 360/375/768px, 44px tap targets, notification panel |

### Static analysis

| Check | Backend | Frontend |
|---|---|---|
| TypeScript `--noEmit` | 0 errors | 0 errors |
| ESLint | 0 errors | 0 errors |
| Production build | ✅ | ✅ |

---

## 3. Database

Applied to a **fresh, empty** Postgres 16 + pgvector container:

- **7 migrations applied**, `migrate status` → *"Database schema is up to date"*
- **17 tables**, **67 indexes** created
- No pending migrations, no failed migrations

### Schema drift — 1 finding, expected

```
[*] Changed the `products` table
  [-] Removed index on columns (embedding)
```

This is `products_embedding_hnsw_idx`, the pgvector HNSW index. **Prisma has
no syntax for HNSW indexes**, so it can never appear in `schema.prisma` and
will always be reported as drift.

**Risk:** `prisma migrate dev` will offer to drop it. Accepting would turn
every vector search into a sequential scan with no error anywhere.

**Mitigation in place:** documented in `schema.prisma` beside the column, and
every *other* index is now explicitly declared so this is the only drift the
tool should ever report. Anything more means something is genuinely wrong.

---

## 4. Security

### Tenant isolation — the highest-risk area

Two tenants were registered, one created a product and a variant, and the
other attacked it directly:

| Attack | Result | Expected |
|---|---|---|
| A reads own product | 200 | 200 ✅ |
| **B reads A's product** | **404** | 404 ✅ |
| **B writes a variant to A's product** | **404** | 404 ✅ |
| **B deletes A's product** | **404** | 404 ✅ |
| **B lists A's variants** | **0 items** | 0 ✅ |

404 rather than 403 is correct: tenant B is not told the resource exists.

This matters because the original audit found **two cross-tenant leaks** that
had reached production. The isolation boundary is `tenantId`, present in **62
places** across the schema.

### Authentication and input validation

| Test | Result | Expected |
|---|---|---|
| Request without a token | 401 | 401 ✅ |
| Malformed JWT | 401 | 401 ✅ |
| Negative stock quantity | 400 | 400 ✅ |
| Duplicate variant combination | 400 | 400 ✅ |
| Weak password at registration | 400 | 400 ✅ |
| `'; DROP TABLE products;--` as a product name | 201, stored as text; **`products` table intact** | ✅ |

The last one confirms Prisma's parameterisation is holding — the payload was
stored as an ordinary string.

### Production security headers

```
content-security-policy: default-src 'self'; object-src 'none'; script-src 'self'; ...
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
```

`x-powered-by` is absent. `/api/docs` returns **404** in production — API
documentation is correctly disabled outside development.

### Rate limiting

Global throttle is active and advertised in response headers:

```
X-RateLimit-Limit-short: 10   (per second)
X-RateLimit-Limit-long: 100   (per minute)
```

Auth routes default to **5 registrations/minute** per IP
(`AUTH_RATE_LIMIT`, `AUTH_RATE_TTL_MS`).

⚠️ **Operational note:** any test suite that registers a tenant per test is
throttled into failure at this default. CI sets `AUTH_RATE_LIMIT=1000` for the
E2E job. This is documented in `.env.example`.

---

## 5. Deployment artifact

The production Docker image was built and run against a clean database:

```
[entrypoint] migrations applied successfully
[AiProvider] Using Groq
[EmbeddingProvider] No embedding provider — product search uses text matching
🚀 CommercePilot API running on: http://localhost:3001/api/v1
```

- Image builds with exit 0
- Migrations run automatically on boot, with bounded retry
- Dependency-injection graph resolves — **this check is not optional**: a DI
  cycle was previously introduced that passed all 339 unit tests and only
  failed at container start, because unit tests never build the module graph
- Starts with **no AI keys configured**, falling back to canned responses
  rather than crashing

---

## 6. Production health

| Endpoint | Result |
|---|---|
| `/api/v1/health` | **200** in 0.19s |
| `/api/v1/health/ready` | `{"status":"ready","checks":{"database":"up"}}` |
| `/api/v1/products` (no token) | **401** |
| `/api/v1/products/:id/variants` (no token) | **401** |
| `/api/docs` | **404** — correctly disabled |

`/health/ready` genuinely queries the database, so this confirms the Neon
connection is live — not merely that the process is running.

**Latency (local, warm):** `/health` 3ms, `/products` 7ms.

---

## 7. Gaps and risks

### 🔴 Blocking for commercial use

**AI capacity.** See §8.

### 🟡 Should be addressed before real customers

**Email notifications fail.** The dashboard shows `EMAIL · FAILED` on owner
alerts; no mail provider is configured. WhatsApp notifications work. The
system reports the failure rather than hiding it, but owners will not receive
email.

**Untested code paths.** Coverage is 0% on:
- `common/interceptors` — request/response transformation
- `common/filters` — global exception handling, i.e. what customers see when
  something breaks
- `common/observability` — Sentry wiring

`auth` at 33.68% and `notifications` at 31.68% are low for their importance.
None of these are known-broken; they are unverified.

**Extraction accuracy is 45.8%**, measured on 24 *invented* messages. Real
traffic will differ. Known failure classes: price questions read as orders,
Singlish quantities dropped (`2k`, `3k`), colours occasionally missed. This
needs 50+ real customer messages in `backend/eval/dataset.csv`.

**No load testing.** Behaviour under concurrent traffic is unmeasured.

**Single browser.** E2E runs Chromium only — no Firefox, Safari, or real
mobile device testing.

### 🟢 Known and accepted

**Semantic search is off.** The Jina embedding key has zero balance, so
`EMBEDDING_PROVIDER=none` and product search uses text matching. Correct
degradation, not a fault.

**Voice notes are dropped.** `processMessage` skips non-`TEXT` messages, so a
customer sending audio gets no reply. Whisper is available on the existing
Groq key but unimplemented.

**WooCommerce fetches page 1 only.** A shop with more than one page of
products would have a silently incomplete catalogue. Latent — every tenant is
currently on `MOCK`.

**Shopify has no adapter.** It appears in the settings enum with no
implementation behind it.

---

## 8. The capacity ceiling

Measured from real evaluation runs, not estimated.

| Item | Value |
|---|---|
| Tokens per customer message | **~3,250** (intent ~2,300 + extraction ~950) |
| Groq free tier, per minute | 12,000 |
| Groq free tier, per day | 100,000 |
| **Messages per day, whole platform** | **~30** |
| **Messages per minute** | **~3** |

The catalogue context dominates both prompts. This ceiling is shared across
**all tenants**, and evaluation runs consume the same budget.

A single WhatsApp-first shop will exceed 30 messages before lunch.

**The fix is engineering, not billing:**

1. Send only the top 3 retrieved products instead of the full catalogue
   context — this is the bulk of the cost
2. Fold intent detection into the extraction call — one request per message
   instead of two

Estimated result: **3,250 → under 1,000 tokens**, roughly 100 messages/day on
the same free tier.

---

## 9. Recommended next steps

**Before charging anyone:**

1. Reduce tokens per message (§8) — nothing else matters until this is done
2. Configure an email provider so owner alerts arrive
3. Collect 50+ real WhatsApp messages into `eval/dataset.csv` and re-measure
   accuracy against real traffic

**Before a real shop goes live:**

4. Run `npm run backfill:variants` in production, verify the Variants modal,
   then set `VARIANT_STOCK_ENABLED=true`
5. Implement WooCommerce pagination — currently silently incomplete beyond
   page 1
6. Add tests for `common/filters` and `common/interceptors` — currently 0%,
   and they determine what a customer sees when something fails

**Worth doing:**

7. Load testing under concurrent traffic
8. Cross-browser E2E (Firefox, WebKit)
9. Implement voice notes — Whisper is already available on the current key

---

## 10. How this report was produced

Every result was executed and observed on 4 August 2026 against commit
`0b082ba`. Test commands:

```bash
# Backend unit tests + coverage
cd backend && npx jest --ci --coverage

# End-to-end
cd frontend && npx playwright test

# Static analysis
npx tsc --noEmit && npx eslint .

# Migrations against an empty database
npx prisma migrate deploy && npx prisma migrate status
npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma

# Deploy artifact
docker build -t cp-qa . && docker run --rm cp-qa
```

Security tests were run as live HTTP requests against a running instance with
two separately registered tenants, not as mocked unit tests.

**One caveat worth recording:** three E2E runs during this session initially
failed for environmental reasons — Postgres stopped, a stale Redis connection
after a container restart, and the auth throttle at production defaults. Each
was diagnosed and corrected before the results above were recorded. The
18/18 figure comes from two consecutive clean runs on a correctly configured
stack.
