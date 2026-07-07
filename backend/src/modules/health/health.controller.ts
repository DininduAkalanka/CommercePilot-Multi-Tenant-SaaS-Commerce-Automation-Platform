import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe — the process is up (no external deps)' })
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
