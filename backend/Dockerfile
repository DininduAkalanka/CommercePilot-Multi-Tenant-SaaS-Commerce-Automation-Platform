# ─────────────────────────────────────────────────────────────────
# CommercePilot API — production image
# Build context is ./backend (see render.yaml → dockerContext).
# ─────────────────────────────────────────────────────────────────

# ---- Build stage ------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Prisma needs OpenSSL to generate the correct query engine on Alpine (musl).
RUN apk add --no-cache openssl

# Install ALL deps (incl. dev) against the committed lockfile — reproducible.
COPY package.json package-lock.json ./
RUN npm ci

# Generate the Prisma client, then compile the Nest app to ./dist.
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# ---- Runtime stage ----------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl

# Copy the built app plus node_modules (kept whole so the Prisma CLI is
# available to run `migrate deploy` at container start). Image size is a
# non-issue on the free tier; it can be slimmed later by moving `prisma` to
# dependencies and running `npm prune --omit=dev`.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

COPY docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

# Drop root. The image previously ran as uid 0, so any RCE in a dependency
# started with full container privileges. `node` (uid 1000) ships with the
# base image. Ownership is set so Prisma can still write its engine cache.
RUN chown -R node:node /app
USER node

# Render assigns the port via $PORT and detects it automatically; EXPOSE is
# documentation only. main.ts reads process.env.PORT.
EXPOSE 3001

# Applies pending migrations (idempotent — only committed migrations run),
# retrying past a cold scale-to-zero database, then starts the API together
# with its in-process BullMQ worker. See the script for the full rationale.
CMD ["./docker-entrypoint.sh"]
