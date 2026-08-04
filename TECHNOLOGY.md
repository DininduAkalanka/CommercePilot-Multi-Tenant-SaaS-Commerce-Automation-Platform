# Technology

Every significant dependency, the version in use, and why it was chosen over
the obvious alternative. Where a choice has since caused a problem, that is
recorded too.

- [At a glance](#at-a-glance)
- [Backend](#backend)
- [Database](#database)
- [Queue and cache](#queue-and-cache)
- [AI and embeddings](#ai-and-embeddings)
- [Frontend](#frontend)
- [External integrations](#external-integrations)
- [Testing](#testing)
- [Tooling and CI](#tooling-and-ci)
- [Infrastructure](#infrastructure)
- [Version reference](#version-reference)

---

## At a glance

| Layer | Choice |
|---|---|
| Backend | NestJS 11 · TypeScript strict |
| Frontend | Next.js 16 (App Router) · React 19 |
| Database | PostgreSQL 16 + pgvector · Prisma 5 |
| Queue | BullMQ on Redis 7 |
| AI | Groq (`llama-3.3-70b-versatile`) behind a provider interface |
| Embeddings | Jina `jina-embeddings-v3` at 768 dimensions |
| Testing | Jest (376 unit) · Playwright (22 E2E) |
| Hosting | Render · Vercel · Neon · Upstash |

---

## Backend

### NestJS 11

Chosen for **dependency injection and module boundaries**, which is what makes
Clean Architecture enforceable rather than aspirational. Provider swapping —
Gemini to Groq — was a change to one factory because everything else depends on
an injected interface.

The DI graph is also a real correctness check. A dependency cycle introduced
during the variant work passed all 339 unit tests and failed only at container
start, because unit tests construct services directly and never build the module
graph. **Booting the container is part of verification, not an optional extra.**

### TypeScript, strict

`strict: true`, `noEmit` in CI, zero errors required to merge. Target ES2023.

Strict mode has caught real defects here — including an interface method left
out during the provider migration that would have thrown at runtime on two
services.

### Validation — class-validator / class-transformer

DTO-level validation with a global `ValidationPipe` (`whitelist`,
`forbidNonWhitelisted`). Unknown properties are rejected rather than ignored.

Validation is deliberately duplicated between DTO and service. The DTO gives a
clear field-level error early; the service still enforces the same rule because
the WooCommerce sync and the variant backfill call it directly, without ever
passing through a DTO.

### Auth — Passport JWT

Short-lived access tokens, opaque refresh tokens stored as SHA-256 hashes.
Bearer header only — **no query-string tokens anywhere**, including the SSE
stream, which is pinned by a regression test.

Passwords are bcrypt-hashed. Registration enforces the same complexity policy as
the rest of the system.

### Rate limiting — @nestjs/throttler 6.5

Two named windows: `short` (10/s) and `long` (100/min), plus a stricter auth
limit (`AUTH_RATE_LIMIT`, default 5/min).

⚠️ **Version-specific gotcha, recorded because it cost real debugging:** in 6.x,
bare `@SkipThrottle()` defaults to `{ default: true }` and skips a throttler
*named* `default`. With throttlers named `short` and `long`, it skips nothing.
Health probes and the WhatsApp webhook carried the bare decorator and were being
throttled anyway — 50 of 60 concurrent health checks returned 429. Always name
them: `@SkipThrottle({ short: true, long: true })`.

### Security middleware — Helmet

CSP, HSTS, `nosniff`, `X-Frame-Options`, `x-powered-by` removed. Verified live
in production.

### Encryption

AES-256-GCM for integration credentials at rest (WhatsApp tokens, WooCommerce
keys), versioned envelope so keys can be rotated later.

---

## Database

### PostgreSQL 16

Relational because the domain is relational: orders belong to customers, items
belong to orders, stock must decrement transactionally. Nothing here wanted a
document store.

### pgvector

Product embeddings live in the same database as the products they describe —
`vector(768)` with an **HNSW** index and cosine distance. A dedicated vector
database would mean a second store to keep consistent for a catalogue of a few
hundred rows per tenant.

⚠️ **Prisma cannot express HNSW indexes.** `products_embedding_hnsw_idx` is
created in raw SQL and will always appear as schema drift. `prisma migrate dev`
offers to drop it; accepting turns every vector search into a sequential scan
with no error anywhere. Every other index is explicitly declared so this remains
the only expected drift.

### Prisma 5.22

Type-safe queries generated from the schema, and **parameterisation by default**
— verified by sending `'; DROP TABLE products;--` as a product name, which was
stored as ordinary text with the table intact.

Migrations are file-based and applied with `migrate deploy` on container boot.

Raw SQL is used in exactly two places where the query planner matters: vector
similarity search, and the daily activity aggregation for the assistant chart.
Both use parameter binding, and both quote camelCase identifiers — Postgres
folds unquoted identifiers to lowercase, which silently broke vector search
until it was found.

---

## Queue and cache

### Redis 7 + BullMQ

The WhatsApp webhook must answer Meta immediately or be retried, so processing
is queued rather than inline. BullMQ provides retries with backoff and survives
restarts.

Redis also holds conversation state for multi-turn extraction.

**Redis is deliberately off the request path.** Verified by stopping it: HTTP
requests, authentication and database writes all continued.

---

## AI and embeddings

### Groq — `llama-3.3-70b-versatile`

**Why not Gemini.** Gemini was the original choice and had to be abandoned: its
free tier is region-gated. A key created in Sri Lanka lists all 50 models and
then fails the first real call with
`limit: 0, metric: generate_content_free_tier_requests`. The allocation is zero,
not exhausted, and raising it requires a payment card that is hard to obtain
locally.

Groq serves the region, is free, and returns in roughly 200–400 ms. Accessed
over its OpenAI-compatible REST endpoint via `fetch` — the payload shape was
confirmed by hand first, so an SDK would have added a dependency for one HTTP
POST.

**Measured quality** on invented test messages: English is reliable; Singlish
mostly works; Sinhala colour and quantity extraction is unreliable
(`නිල්`/blue read as black, `2ak`/two dropped). This is why the 0.95
auto-approve floor is load-bearing rather than decorative.

⚠️ **The binding constraint.** Free tier is 12,000 tokens/minute and
**100,000/day**, shared across all tenants. At ~3,250 tokens per message that is
roughly **30 messages per day for the entire platform**. The fix is engineering,
not billing: send the top 3 retrieved products instead of the full catalogue
context, and fold intent detection into the extraction call.

### Jina — `jina-embeddings-v3`

Chosen for one concrete reason: it emits **768 dimensions on request**.
`products.embedding` is `vector(768)` with an HNSW index built for that width,
so Cohere v3 (1024) or OpenAI (1536/3072) would have forced a migration, a new
index, and a full re-embed.

Uses `task: 'text-matching'`, which is measured rather than defaulted — the
asymmetric `retrieval.query` / `retrieval.passage` modes scored Sinhala queries
*negatively* against English catalogue text.

⚠️ Currently inactive: the key has zero balance, so `EMBEDDING_PROVIDER=none`
and search falls back to text matching. Correct degradation, not a fault.

### Groq Whisper — available, unused

`whisper-large-v3` is on the same key and was verified working (~3.7 s for a
14 s clip). Voice notes are still dropped by `processMessage`, so this is
implemented capacity waiting on pipeline work.

### The mock

A shared, **stage-aware** canned extractor runs when no key is configured. It
distinguishes intent from extraction, parses the tenant-scoped catalogue out of
the prompt, and returns a realistically matched item.

That matters more than it sounds. A placeholder version that always returned
`items: []` broke the pipeline for anyone cloning without credentials and took
two E2E tests with it — and nothing caught it because E2E was not running in CI.
It now runs with no key deliberately, so a broken mock fails the build.

---

## Frontend

### Next.js 16, App Router

Server components by default, client components where interaction demands it.
This is **not** the Next.js of older tutorials — async request APIs, `params` as
promises, and Turbopack by default are all breaking changes from 15. The bundled
docs in `node_modules/next/dist/docs/` are the reference.

### React 19

### Recharts 3

Charts are declarative React components using CSS custom properties, so they
follow the light/dark theme without a second palette.

### Styling — CSS custom properties + styled-jsx

A hand-built token system (surfaces, ink, brand, radii, shadows) rather than a
utility framework. Warm cream and deep green, not a default blue.

⚠️ **styled-jsx scoping gotcha, recorded because it shipped a visible bug:**
styles in a `<style jsx>` block only apply to JSX written **inside that same
component**. A card rendered by a component declared outside the page received
none of its styles and fell back to `display: block`, with icons wrapping under
the text. Shared primitives belong in `globals.css`.

### Responsive

Tested down to **360px** — the CSS viewport a large share of Sri Lankan Android
handsets report, and the market this product serves. Five automated tests assert
no horizontal overflow at 360/375/768px and a 44px minimum tap target.

---

## External integrations

### WhatsApp — Meta Cloud API

Webhooks verified with HMAC-SHA256 (`x-hub-signature-256`) **on the raw body**,
before parsing — verifying a re-serialised object compares different bytes and
fails intermittently.

`referral` payloads from Click-to-WhatsApp ads are captured and fed into
retrieval, because a customer who tapped an ad often writes only "I want this".

A `MOCK` provider and an in-dashboard simulator run the full pipeline with no
Meta account, which is what makes the product testable before a shop commits
their real business number.

### WooCommerce — REST API

Product pull and idempotent order push behind `IEcommerceAdapter`.

⚠️ `getProducts()` fetches **page 1 only** and logs a warning. A shop with more
than one page would have a silently incomplete catalogue. Latent — every tenant
is currently on `MOCK`.

`SHOPIFY` exists in the provider enum with **no adapter behind it**.

### Email

SMTP via MailHog locally. ⚠️ No provider configured in production, so owner
email alerts currently fail — visible as `EMAIL · FAILED` in the notifications
feed. WhatsApp notifications work.

### Sentry — optional

Wired for 5xx only. 4xx is expected traffic and would bury real defects.
Inactive without `SENTRY_DSN`.

---

## Testing

### Jest — 376 unit tests, 36 suites

Overall statement coverage is **52.93%**, concentrated where risk is:

| Module | Statements |
|---|---|
| `integrations/services` | 96.77% |
| `ai-engine/adapters` | 80.86% |
| `ai-engine` | 78.18% |
| `products` | 77.48% |
| `common/interceptors`, `observability` | **0%** |

The zeros are honest gaps. `common/filters` was also 0% until a QA pass found an
information-disclosure defect there — which is the argument for closing the rest.

### Playwright — 22 E2E tests

Hermetic: each spec registers its own throwaway tenant against the live API and
runs against mock providers, so no external accounts and no shared state.

| Suite | Covers |
|---|---|
| `order-flow` | message → draft → correction → approval → sync |
| `human-handoff` | escalation, notify-once, no false escalation |
| `regression` | previously-fixed defects |
| `ai-performance` | metrics page states, endpoint auth |
| `auth` | register → dashboard → logout → login |
| `responsive-audit` | overflow, tap targets, panel positioning |
| `throttle-exemptions` | health and webhook survive bursts; other routes stay limited |

Runs in CI **without an AI key**, so it stays deterministic, costs no quota, and
fails if the mock breaks.

### Evaluation harness

`npm run eval` scores extraction against a labelled CSV.

⚠️ Read its output carefully. The harness had three faults that made every prior
run meaningless: it never loaded `.env` (so it measured the mock), it hard-coded
the old adapter, and it reported rate-limit failures as malformed JSON. Current
figure is **45.8% on 24 invented messages** — a real number, but not a measure of
real traffic. That needs 50+ actual customer messages.

---

## Tooling and CI

ESLint (zero errors to merge) · Prettier · Husky + lint-staged · Swagger, dev
only — `/api/docs` returns 404 in production, verified.

**GitHub Actions:** backend build and test → frontend build and lint → **E2E** →
deploy. Deploys are gated on E2E.

⚠️ Two CI gotchas worth knowing. `actions/setup-node` resolves the npm cache from
the repository root, so a monorepo needs explicit `cache-dependency-path` per
workspace. And `NODE_ENV=production` at job level makes `npm ci` skip
devDependencies — which removes the Nest CLI, the Next build toolchain and
Playwright, producing `nest: not found`.

---

## Infrastructure

| Environment | Stack |
|---|---|
| **Local** | Docker Compose — Postgres 16 + pgvector, Redis 7, MailHog |
| **Backend** | Render, Docker, migrations on boot with bounded retry |
| **Frontend** | Vercel |
| **Database** | Neon (Singapore — closest region to the market) |
| **Redis** | Upstash |

⚠️ Render's free tier spins the instance down when idle, taking **50s+** to wake.
A WhatsApp webhook arriving cold may time out before the service responds; Meta
retries, so messages are delayed rather than lost. Not fixable on the free plan.

---

## Version reference

| Package | Version |
|---|---|
| `@nestjs/core` | ^11.0.1 |
| `@nestjs/throttler` | ^6.5.0 |
| `@prisma/client` | ^5.22.0 |
| `bull` | ^4.16.5 |
| `next` | 16.2.12 |
| `react` | 19.2.4 |
| `recharts` | ^3.9.0 |
| `@playwright/test` | ^1.61.1 |
| PostgreSQL | 16 + pgvector 0.8.1 |
| Redis | 7 |
| Node | 20 (CI), 24 (local) |

---

Related: [`README.md`](README.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) ·
[`Documents/QA_REPORT.md`](Documents/QA_REPORT.md)
