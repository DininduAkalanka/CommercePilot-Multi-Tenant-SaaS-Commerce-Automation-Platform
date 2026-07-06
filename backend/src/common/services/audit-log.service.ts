import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';

/**
 * CreateAuditLogInput
 *
 * All fields required for an immutable audit log entry.
 * - actorUserId is null for SYSTEM or AI actions.
 * - beforeState is null for CREATE actions.
 * - afterState is null for DELETE actions.
 */
export interface CreateAuditLogInput {
  tenantId: string;
  actorUserId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'AI';
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

/**
 * AuditLogService
 *
 * Centralized, reusable service for creating immutable audit log entries.
 * Replaces scattered inline `prisma.auditLog.create()` calls across modules.
 *
 * Architecture Rule: Audit logs are immutable — never update or delete.
 * Business Rule: Every business event must be recorded (§19).
 *
 * Usage:
 *   await this.auditLog.create({
 *     tenantId,
 *     actorUserId: userId,
 *     actorType: 'USER',
 *     action: 'ORDER_APPROVED',
 *     entityType: 'Order',
 *     entityId: orderId,
 *     afterState: { status: 'APPROVED' },
 *   });
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an immutable audit log entry.
   * Generates a UUID for the log record (backend-generated as per architecture rules).
   *
   * This method never throws — audit log failures are logged but do not
   * break the calling business operation.
   */
  async create(input: CreateAuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          actorType: input.actorType,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          beforeState: (input.beforeState ?? null) as any,
          afterState: (input.afterState ?? null) as any,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          correlationId: input.correlationId ?? null,
        },
      });
    } catch (error: unknown) {
      // Audit log creation should never break the calling operation.
      // Log the error internally and continue.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to create audit log for ${input.action} on ${input.entityType}:${input.entityId}: ${message}`,
      );
    }
  }

  /**
   * Create an audit log entry within a Prisma transaction.
   * Use this when the audit log must be part of a larger atomic operation.
   */
  async createInTransaction(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    input: CreateAuditLogInput,
  ): Promise<void> {
    await (tx as any).auditLog.create({
      data: {
        id: uuidv4(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeState: (input.beforeState ?? null) as any,
        afterState: (input.afterState ?? null) as any,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        correlationId: input.correlationId ?? null,
      },
    });
  }
}
