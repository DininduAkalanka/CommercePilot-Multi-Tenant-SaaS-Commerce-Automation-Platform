import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { IRedisService } from '../interfaces/redis-service.interface';
import { buildRedisConnection } from '../../../common/redis/redis.util';

/**
 * IoRedisAdapter
 *
 * Production implementation of IRedisService using ioredis.
 * ioredis is already installed as a dependency of BullMQ.
 *
 * Implements OnModuleInit/OnModuleDestroy for clean lifecycle management.
 * In test environments, this is replaced by a mock implementation.
 */
@Injectable()
export class IoRedisAdapter
  implements IRedisService, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IoRedisAdapter.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const connection = buildRedisConnection(this.configService);
    const options = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    };

    // A string connection is a full URL (managed Redis, TLS auto-detected from
    // the rediss:// scheme); an object is discrete host/port for local dev.
    this.client =
      typeof connection === 'string'
        ? new Redis(connection, options)
        : new Redis({ ...connection, ...options });

    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result > 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }
}
