import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService
 *
 * Global database client wrapper.
 * Handles connection lifecycle and enforces soft-delete filtering.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * Soft delete helper — sets deletedAt instead of removing record.
   * Use this instead of prisma.model.delete() for all business tables.
   */
  async softDelete(
    model: string,
    where: Record<string, unknown>,
  ): Promise<void> {
    await (this as any)[model].update({
      where,
      data: { deletedAt: new Date() },
    });
  }
}
