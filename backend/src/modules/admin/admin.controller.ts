import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { UpdateTenantStatusDto } from './dto/admin.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * AdminController
 *
 * Platform administration — SUPER_ADMIN only. These are the only endpoints
 * that operate across tenant boundaries. Never exposes tenant credentials.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('tenants')
  @ApiOperation({ summary: 'List all tenants on the platform (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated tenant list' })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN role' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by name or slug',
  })
  async listTenants(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    const { data, meta } = await this.adminService.listTenants(
      page,
      limit,
      search,
    );
    return { success: true, data, meta };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide aggregate metrics' })
  @ApiResponse({ status: 200, description: 'Platform statistics' })
  async stats() {
    const data = await this.adminService.platformStats();
    return { success: true, data };
  }

  @Patch('tenants/:id/status')
  @ApiOperation({ summary: 'Activate or suspend a tenant' })
  @ApiResponse({ status: 200, description: 'Tenant status updated' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async setTenantStatus(
    @CurrentUser('sub') actorUserId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    const data = await this.adminService.setTenantStatus(
      actorUserId,
      id,
      dto.isActive,
    );
    return { success: true, message: 'Tenant status updated.', data };
  }
}
