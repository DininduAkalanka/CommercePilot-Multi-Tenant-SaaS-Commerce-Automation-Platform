import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * AdminModule
 *
 * SUPER_ADMIN platform operations. PrismaService and AuditLogService come from
 * global modules, so no imports are required here.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
