import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuditLogsService } from './audit-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * AuditLogsController
 *
 * Exposes the immutable audit trail (read-only).
 * Restricted to OWNER (and SUPER_ADMIN, which bypasses in RolesGuard) —
 * staff must not read the full tenant audit history.
 * Tenant isolation is enforced by scoping every query to the caller's tenantId.
 */
@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  /**
   * GET /api/v1/audit-logs
   * Paginated, filterable audit trail for the authenticated tenant.
   */
  @Get()
  @ApiOperation({ summary: 'List audit-log entries (paginated, filterable)' })
  @ApiResponse({ status: 200, description: 'Paginated audit-log entries' })
  @ApiResponse({ status: 403, description: 'Requires OWNER role' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'entityType',
    required: false,
    description: 'e.g. Order, Product, User',
  })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({
    name: 'action',
    required: false,
    description: 'e.g. ORDER_APPROVED',
  })
  @ApiQuery({ name: 'actorUserId', required: false })
  async findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('actorUserId') actorUserId?: string,
  ) {
    const { data, meta } = await this.auditLogsService.findAll(tenantId, {
      page,
      limit,
      entityType,
      entityId,
      action,
      actorUserId,
    });
    return { success: true, data, meta };
  }

  /**
   * GET /api/v1/audit-logs/:entityType/:entityId
   * Full history for a single entity (e.g. one order's lifecycle).
   */
  @Get(':entityType/:entityId')
  @ApiOperation({ summary: 'Get the full audit history for a single entity' })
  @ApiResponse({ status: 200, description: 'Entity audit history' })
  async findForEntity(
    @CurrentUser('tenantId') tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const data = await this.auditLogsService.findForEntity(
      tenantId,
      entityType,
      entityId,
    );
    return { success: true, data };
  }
}
