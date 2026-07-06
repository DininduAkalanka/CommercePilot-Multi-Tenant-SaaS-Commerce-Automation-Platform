/**
 * IRedisService — Redis abstraction interface.
 *
 * Architecture Rule: Every external dependency must be abstracted
 * behind an interface. This allows swapping Redis implementations
 * without changing consumer code (e.g., ioredis → upstash in production).
 */
export const REDIS_SERVICE = Symbol('REDIS_SERVICE');

export interface IRedisService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  expire(key: string, ttlSeconds: number): Promise<void>;
}
