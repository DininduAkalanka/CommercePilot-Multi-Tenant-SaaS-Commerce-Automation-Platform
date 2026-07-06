import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * UsersModule
 *
 * Tenant team management (OWNER-operated). PrismaService and AuditLogService
 * are provided by global modules, so no imports are required here.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
