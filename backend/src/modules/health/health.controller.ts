import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/database/prisma.service';

interface LivenessStatus {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
}

interface ReadinessStatus {
  status: 'ready' | 'degraded';
  timestamp: string;
  checks: {
    database: 'up' | 'down';
  };
}

/**
 * HealthController
 *
 * Exposes probes used by the hosting platform (Render) and uptime monitors.
 * Mounted under the global `api/v1` prefix, so the paths are:
 *   - GET /api/v1/health        → liveness (no external dependencies)
 *   - GET /api/v1/health/ready  → readiness (database connectivity)
 *
 * Liveness is intentionally dependency-free: the platform's health check must
 * not restart the process just because a managed database is briefly waking
 * from cold start. Readiness is the deeper check used by monitors.
 */
@ApiTags('Health')
@Controller('health')
// The platform health check and any uptime monitor poll these continuously;
// throttling them would make the service look unhealthy and trigger restarts.
// @SkipThrottle() with no argument defaults to { default: true } in
// @nestjs/throttler 6.x — it skips a throttler NAMED "default". This app's
// throttlers are named "short" and "long" (app.module.ts), so the bare form
// skipped nothing and these routes were rate limited at 10 req/s after all.
// Named explicitly so the exemption actually applies.
// Health checks returning 429 make the platform judge the service unhealthy and restart it.
@SkipThrottle({ short: true, long: true })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness probe — the process is up (no external deps)',
  })
  liveness(): LivenessStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — verifies database connectivity' })
  async readiness(): Promise<ReadinessStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // 503 so load balancers / uptime monitors treat the instance as not ready.
      throw new ServiceUnavailableException({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        checks: { database: 'down' },
      } satisfies ReadinessStatus);
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: { database: 'up' },
    };
  }
}
