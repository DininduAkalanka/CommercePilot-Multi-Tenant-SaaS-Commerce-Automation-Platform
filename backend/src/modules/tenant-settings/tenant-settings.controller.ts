import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { TenantSettingsService } from './tenant-settings.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Tenant Settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantSettingsController {
  constructor(private readonly tenantSettingsService: TenantSettingsService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.STAFF)
  @ApiOperation({ summary: 'Get current tenant settings' })
  @ApiResponse({
    status: 200,
    description: 'Tenant settings retrieved successfully',
  })
  async getSettings(@CurrentTenant() tenantId: string) {
    const data = await this.tenantSettingsService.getSettings(tenantId);
    return { success: true, data };
  }

  @Patch()
  @Roles(UserRole.OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update current tenant settings' })
  @ApiResponse({
    status: 200,
    description: 'Tenant settings updated successfully',
  })
  async updateSettings(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateTenantSettingsDto,
  ) {
    const data = await this.tenantSettingsService.updateSettings(tenantId, dto);
    return { success: true, message: 'Settings updated successfully', data };
  }
}
