import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';

export interface FindAuditLogsParams {
  page: number;
  limit: number;
  entityType?: string;
  entityId?: string;
  action?: string;
  actorUserId?: string;
}

/**
 * AuditLogsService
 *
 * Read-only query surface over the immutable audit trail (BUSINESS_RULES §19,
 * PRD US-005). The table is append-only — this service NEVER updates or deletes.
 * Every query is tenant-scoped; cross-tenant access is impossible by construction.
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paginated, filterable audit-log query for a single tenant.
   * Sorted newest-first. Returns data + standard pagination meta.
   */
  async findAll(tenantId: string, params: FindAuditLogsParams) {
    const { page, limit, entityType, entityId, action, actorUserId } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(action ? { action } : {}),
      ...(actorUserId ? { actorUserId } : {}),
    };

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Full audit history for a single entity (e.g. one Order), tenant-scoped.
   * Backs nested history endpoints like GET /orders/:id/history.
   */
  async findForEntity(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, entityType, entityId },
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { timestamp: 'desc' },
    });
  }
}
