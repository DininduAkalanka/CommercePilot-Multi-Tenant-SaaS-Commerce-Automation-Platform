import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * HealthModule
 *
 * Provides liveness/readiness probes. PrismaService is available globally via
 * the @Global DatabaseModule, so no additional imports are required.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
