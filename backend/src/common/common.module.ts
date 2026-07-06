import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './services/encryption.service';
import { AuditLogService } from './services/audit-log.service';

/**
 * CommonModule
 *
 * Global module for cross-cutting infrastructure services that are not
 * tied to a single feature module:
 *   - EncryptionService — encryption of restricted data at rest.
 *   - AuditLogService   — immutable, reusable audit trail writer (§19).
 *
 * ConfigModule and DatabaseModule are already global, so services here can
 * inject ConfigService / PrismaService.
 */
@Global()
@Module({
  providers: [EncryptionService, AuditLogService],
  exports: [EncryptionService, AuditLogService],
})
export class CommonModule {}
