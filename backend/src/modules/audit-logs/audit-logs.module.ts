import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

/**
 * AuditLogsModule
 *
 * Read-only query API over the immutable audit trail.
 * The audit *writer* (AuditLogService) lives in the global CommonModule so any
 * module can record events; this module is purely for querying them.
 */
@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
