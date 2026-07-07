# CommercePilot — Free Deployment Guide (Step by Step)

This guide takes CommercePilot **live on the internet for $0**, with automatic
deploys every time you push to `main`. It is written to be followed top to
bottom. No prior DevOps experience needed.

> **Important — nothing here charges you.** Every service below has a free tier
> that needs **no credit card**. You will create 4 free accounts.

---

## 1. What gets hosted where

| Part of the app | Free host | What it does |
|---|---|---|
| Frontend (Next.js) | **Vercel** | The website users visit |
| Backend API + worker (NestJS) | **Render** | The API + background jobs |
| Database (PostgreSQL + pgvector) | **Neon** | Stores all data |
| Redis (queue) | **Upstash** | Background job queue |
| Tests + auto-deploy | **GitHub Actions** | Runs tests, then deploys |

**How a change reaches the live site:**

```
you edit code → git push origin main → GitHub Actions runs your tests
   → tests pass ✅ → backend deploys to Render + frontend deploys to Vercel
   → tests fail ❌ → deploy is blocked, live site stays on the last good version
```

⚠️ **One honest limitation (expected on the free tier):** the backend **sleeps
after ~15 minutes of no traffic**, so the *first* visit after idle takes ~50
seconds to wake up. This is normal for a free portfolio/demo and is **not** a
crash. Everything after that first request is fast.

---

## 2. Before you start — the accounts you need

You will create these **4 free accounts**. Sign up for each using **"Continue
with GitHub"** where offered — it makes everything easier.

1. **Neon** — https://neon.tech (database)
2. **Upstash** — https://upstash.com (Redis)
3. **Render** — https://render.com (backend)
4. **Vercel** — https://vercel.com (frontend)

(You already have the 5th: your **GitHub** account, where the code lives.)

Do them **in the order below** — later steps need values from earlier ones.

---

## 3. Step 0 — Push the code to GitHub (safe, does NOT deploy yet)

Everything I built is currently only on your computer. To deploy, GitHub needs
it. **Pushing is safe** — it just runs your tests. Nothing goes live until you
connect Render and Vercel in the later steps.

```bash
git add .
git commit -m "Add free deployment: CI/CD, Docker, health checks, hardening"
git push origin main
```

After this, open your repo on GitHub → **Actions** tab. You'll see the CI/CD
pipeline run your tests. The "Deploy backend" step will show a yellow warning
("secret not set yet — skipping") — that's expected until Step 6.

---

## 4. Step 1 — Create the database (Neon)

1. Go to https://neon.tech and sign up (Continue with GitHub).
2. Click **Create project**. Name it `commercepilot`. Leave defaults. Create.
3. On the project dashboard, find **Connection string**.
4. **Turn OFF the "Pooled connection" toggle** (we need the *direct* connection
   so database migrations work reliably).
5. Copy the string. It looks like:
   ```
   postgresql://commercepilot_owner:AbCdEf123@ep-cool-name-123456.us-east-2.aws.neon.tech/commercepilot?sslmode=require
   ```
6. **Save this** somewhere temporary — it's your `DATABASE_URL`.

> pgvector is enabled automatically by the app's first migration — you don't
> need to do anything for it.

---

## 5. Step 2 — Create Redis (Upstash)

1. Go to https://upstash.com and sign up (Continue with GitHub).
2. Click **Create Database** → type **Redis**.
3. Name it `commercepilot`. Pick a region close to you. Choose the **Free** plan.
   Create.
4. On the database page, scroll to **Connect** and pick the **`ioredis` / Node**
   tab (or just the connection string). Copy the URL that starts with `rediss://`:
   ```
   rediss://default:AbCdEf123456@cool-name-12345.upstash.io:6379
   ```
5. **Save this** — it's your `REDIS_URL`. (The `rediss://` means TLS is on — the
   code handles that automatically.)

---

## 6. Step 3 — Generate two secret keys

The backend needs two random secrets. Run this **twice** in a terminal (you have
Node installed) and save both outputs:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- First output → `JWT_SECRET`
- Second output → `ENCRYPTION_KEY`

Each is 64 characters. Keep them private.

---

## 7. Step 4 — Deploy the backend (Render)

1. Go to https://render.com and sign up (Continue with GitHub).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub and select the **CommercePilot** repository.
4. Render reads the `render.yaml` I created and shows a service called
   **commercepilot-api**. Click **Apply**.
5. Render will ask you to fill in the secret environment variables (the ones
   marked "sync: false"). Enter:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your Neon string from Step 1 |
   | `REDIS_URL` | your Upstash string from Step 2 |
   | `JWT_SECRET` | first key from Step 3 |
   | `ENCRYPTION_KEY` | second key from Step 3 |
   | `FRONTEND_URL` | `https://placeholder.vercel.app` (fix in Step 8) |

6. Click **Create / Apply**. Render builds the Docker image, runs the database
   migrations automatically, and starts the API. First build takes ~5 minutes.
7. When it's live, copy your backend URL from the top of the page, e.g.:
   ```
   https://commercepilot-api.onrender.com
   ```
   Your API base is that **plus `/api/v1`**:
   `https://commercepilot-api.onrender.com/api/v1`
8. Test it: open `https://commercepilot-api.onrender.com/api/v1/health` in your
   browser. You should see `{"status":"ok",...}`.

---

## 8. Step 5 — Get the Render Deploy Hook

This is the secret URL GitHub Actions uses to trigger deploys after tests pass.

1. In Render, open your **commercepilot-api** service → **Settings**.
2. Scroll to **Deploy Hook**. Copy the URL (looks like
   `https://api.render.com/deploy/srv-xxxx?key=yyyy`).
3. **Save it** for the next step.

---

## 9. Step 6 — Give GitHub the deploy hook

1. Open your repo on GitHub → **Settings** → **Secrets and variables** →
   **Actions**.
2. Click **New repository secret**.
3. Name: `RENDER_DEPLOY_HOOK_URL` — Value: the URL from Step 5. Save.

Now, every push to `main` that passes tests will automatically redeploy the
backend.

---

## 10. Step 7 — Deploy the frontend (Vercel)

1. Go to https://vercel.com and sign up (Continue with GitHub).
2. Click **Add New… → Project** and import your **CommercePilot** repo.
3. **Important:** set **Root Directory** to `frontend` (click Edit next to Root
   Directory and choose the `frontend` folder). Framework auto-detects as
   **Next.js**.
4. Expand **Environment Variables** and add one:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://commercepilot-api.onrender.com/api/v1` |

   (Use *your* Render URL from Step 4, keeping the `/api/v1` at the end.)
5. Click **Deploy**. After ~1–2 minutes you get your live site URL, e.g.:
   ```
   https://commercepilot.vercel.app
   ```

---

## 11. Step 8 — Connect frontend ↔ backend (fix CORS)

The backend must allow requests from your Vercel site.

1. Go back to **Render** → your service → **Environment**.
2. Edit `FRONTEND_URL` and set it to your real Vercel URL from Step 7
   (e.g. `https://commercepilot.vercel.app`). Save.
3. Render redeploys automatically (~2 min).

✅ **You are now live.** Open your Vercel URL, register an account, and log in.
(The very first API call may take ~50s while the backend wakes up — normal.)

---

## 12. Step 9 — Turn on the free "production-grade" hardening

These are all free and make it genuinely professional.

### a) Branch protection (stops broken code reaching `main`)
GitHub repo → **Settings** → **Branches** → **Add branch ruleset** (or "Add
rule") for `main`:
- ✅ Require a pull request before merging
- ✅ Require status checks to pass → select **Backend · build & test**,
  **Frontend · build & lint**, and **Analyze (javascript-typescript)**.

Now nobody (including you) can merge code that fails tests.

### b) Security scanning (already active)
`CodeQL` (code security scan) and `Dependabot` (dependency updates) start
working automatically once the files are on `main`. Check results under the
repo's **Security** tab. If Dependabot alerts are off: **Settings → Advanced
Security → enable Dependabot alerts**.

### c) Preview deployments (already active)
Every Pull Request automatically gets its own live preview URL from Vercel —
test changes *before* they hit production. Nothing to configure.

### d) Uptime monitoring
1. Sign up free at https://uptimerobot.com.
2. Add a **HTTP(s)** monitor for
   `https://commercepilot-api.onrender.com/api/v1/health`, interval 5 minutes.
   You'll get an email if the site goes down.
   > Note: pinging every 5 min keeps the backend awake (uses more of Render's
   > ~750 free hours/month). For a pure portfolio, you can skip this and let it
   > sleep between visits.

### e) (Optional) Error tracking — Sentry
Not required, but recommended for real projects. See
[§14 Optional add-ons](#14-optional-add-ons).

---

## 13. Day-to-day: how you ship changes from now on

```bash
# 1. make your code change locally
# 2. commit and push
git add .
git commit -m "describe your change"
git push origin main
```

That's it. GitHub Actions runs the tests; if they pass, backend redeploys to
Render and frontend redeploys to Vercel automatically. If a test fails, you get
a red ❌ on your commit and **the live site is untouched**.

> Best practice (once branch protection is on): work on a branch, open a Pull
> Request, review the Vercel preview, merge when CI is green.

---

## 14. Optional add-ons

### Real outbound emails (Resend)
By default, emails are disabled and fail silently (nothing crashes). To send
real emails, sign up free at https://resend.com, create an SMTP key, and set
these env vars on Render:
```
EMAIL_PROVIDER=resend
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<your Resend API key>
```

### Error tracking (Sentry) — backend
1. Sign up free at https://sentry.io, create a **Node/NestJS** project, copy the
   **DSN**.
2. Install the SDK: `cd backend && npm install @sentry/nestjs`
3. Create `backend/src/instrument.ts`:
   ```ts
   import * as Sentry from '@sentry/nestjs';
   if (process.env.SENTRY_DSN) {
     Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
   }
   ```
4. Make it the **very first import** in `backend/src/main.ts`:
   ```ts
   import './instrument';
   ```
5. Set `SENTRY_DSN` in Render's environment. (Left unset → tracking is off.)

### Error tracking (Sentry) — frontend
Run `cd frontend && npx @sentry/wizard@latest -i nextjs` and follow the prompts,
then add `NEXT_PUBLIC_SENTRY_DSN` in Vercel. (Test the build locally first —
this repo uses a newer Next.js.)

### Real AI extraction (Gemini)
Get a free key at https://aistudio.google.com/app/apikey and set `GEMINI_API_KEY`
on Render. Without it, the app uses the built-in mock extractor.

---

## 15. Where each secret lives (reference)

| Secret / value | Set in | Used for |
|---|---|---|
| `DATABASE_URL` | Render env | DB connection |
| `REDIS_URL` | Render env | Queue connection |
| `JWT_SECRET` | Render env | Auth tokens |
| `ENCRYPTION_KEY` | Render env | Encrypt stored credentials |
| `FRONTEND_URL` | Render env | CORS + email links |
| `NEXT_PUBLIC_API_URL` | Vercel env | Frontend → backend URL |
| `RENDER_DEPLOY_HOOK_URL` | GitHub Actions secret | CI-gated deploy trigger |

> **Never** commit real secrets to git. `.env` files are already git-ignored.

---

## 16. Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| First request takes ~50s | Backend was asleep (free tier). Normal. |
| Frontend loads but login fails / CORS error | `FRONTEND_URL` on Render ≠ your Vercel URL, or `NEXT_PUBLIC_API_URL` is wrong / missing `/api/v1`. |
| Render build fails on migrations | `DATABASE_URL` must be the Neon **direct** (non-pooled) string. |
| Deploy step skipped in Actions | `RENDER_DEPLOY_HOOK_URL` secret not set (Step 6). |
| `/api/v1/health` returns error | Check Render logs (service → Logs). Usually a bad env var. |
| Redis/queue errors | `REDIS_URL` must be the `rediss://` (TLS) URL from Upstash. |

---

## 17. Cost summary

| Service | Plan | Cost | Credit card? |
|---|---|---|---|
| GitHub Actions | Free (public repo) | $0 | No |
| Vercel | Hobby | $0 | No |
| Render | Free web service | $0 | No |
| Neon | Free | $0 | No |
| Upstash | Free | $0 | No |
| **Total** | | **$0 / month** | **None** |
