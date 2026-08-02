#!/bin/sh
# ─────────────────────────────────────────────────────────────────
# Container start: apply pending migrations, then run the API.
#
# The retry is deliberate, not defensive padding.
#
# The managed Postgres (Neon, free tier) scales its compute to zero when
# idle. Neon's proxy accepts the TCP connection instantly, so the client
# believes the server was "reached" — but the first statement blocks while
# the compute wakes. Prisma's first statement is a session-scoped
# `pg_advisory_lock`, and it gives up after 10s with:
#
#   Error: P1002 ... was reached but timed out.
#   Context: Timed out trying to acquire a postgres advisory lock.
#
# A single attempt therefore fails any deploy that follows an idle period —
# which is most of them. Retrying spans the cold start instead of failing
# the release. See https://pris.ly/d/migrate-advisory-locking
#
# This does NOT paper over a real migration error: a genuine failure (bad
# SQL, drift, unreachable host) still exhausts the attempts and exits 1, so
# the deploy fails loudly rather than starting against an unmigrated schema.
# ─────────────────────────────────────────────────────────────────
set -e

ATTEMPTS="${MIGRATE_ATTEMPTS:-5}"
DELAY="${MIGRATE_RETRY_DELAY:-10}"

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  echo "[entrypoint] prisma migrate deploy (attempt ${attempt}/${ATTEMPTS})"

  if npx prisma migrate deploy; then
    echo "[entrypoint] migrations applied successfully"
    break
  fi

  if [ "$attempt" -eq "$ATTEMPTS" ]; then
    echo "[entrypoint] migrations failed after ${ATTEMPTS} attempts — refusing to start" >&2
    exit 1
  fi

  echo "[entrypoint] migrate failed; retrying in ${DELAY}s (database may still be waking)"
  sleep "$DELAY"
  attempt=$((attempt + 1))
done

# exec so node replaces the shell as PID 1 and receives SIGTERM directly —
# without this, Render's shutdown signal never reaches the app and the
# container is SIGKILLed after the grace period.
exec node dist/main
