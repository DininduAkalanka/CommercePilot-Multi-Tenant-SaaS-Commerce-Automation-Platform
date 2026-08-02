import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * A connection value accepted by both ioredis (`new Redis(...)`) and
 * `@nestjs/bull` (`{ redis: ... }`).
 *
 * - A `string` is a full connection URL (e.g. Upstash `rediss://...`).
 * - A `RedisOptions` object carries discrete host/port for local dev.
 */
export type RedisConnection = string | RedisOptions;

/**
 * Builds the Redis connection config from the environment, in priority order:
 *
 *   1. `REDIS_URL` — a full connection string. Managed providers (Upstash,
 *      Render Key Value, etc.) issue a `rediss://user:pass@host:port` URL;
 *      ioredis auto-enables TLS for the `rediss://` scheme, so no extra flag
 *      is needed. Used verbatim.
 *   2. `REDIS_HOST` / `REDIS_PORT` — discrete values for the local Docker
 *      Compose stack (no auth, no TLS). Preserves existing dev behaviour.
 *
 * Centralised here so the Bull queue (`app.module.ts`) and the application-level
 * Redis client (`IoRedisAdapter`) never drift apart in how they connect.
 */
export function buildRedisConnection(
  configService: ConfigService,
): RedisConnection {
  const url = configService.get<string>('REDIS_URL');

  if (url && url.trim().length > 0) {
    return url.trim();
  }

  return {
    host: configService.get<string>('REDIS_HOST', 'localhost'),
    port: configService.get<number>('REDIS_PORT', 6379),
  };
}
