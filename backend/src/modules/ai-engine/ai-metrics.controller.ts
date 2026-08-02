import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { UserRole } from '@prisma/client';
import { AiMetricsService } from './ai-metrics.service';
import { UnfulfilledDemandService } from './unfulfilled-demand.service';

/**
 * Operational visibility into the AI pipeline.
 *
 * OWNER and SUPER_ADMIN only: the figures expose how the business is
 * performing (how often the AI is wrong, how much human correction it needs)
 * and are not appropriate for STAFF.
 */
@ApiTags('AI Engine')
@Controller('ai-engine')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AiMetricsController {
  constructor(
    private readonly aiMetricsService: AiMetricsService,
    private readonly unfulfilledDemand: UnfulfilledDemandService,
  ) {}

  @Get('metrics')
  @Roles(UserRole.OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'AI pipeline metrics — stage health, confidence distribution, correction rate',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Window in days (1-90, default 7)',
  })
  async getMetrics(
    @CurrentTenant() tenantId: string,
    @Query('days') days?: string,
  ) {
    const data = await this.aiMetricsService.getMetrics(
      tenantId,
      days ? Number(days) : 7,
    );

    return { success: true, data };
  }

  /**
   * What customers asked for that the catalog could not satisfy.
   *
   * A stocking signal rather than an error report: every row is a real
   * customer who tried to buy something and could not.
   */
  @Get('unfulfilled-demand')
  @Roles(UserRole.OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Products customers asked for that could not be fulfilled',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Window in days (1-365, default 30)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max queries returned (1-100, default 20)',
  })
  async getUnfulfilledDemand(
    @CurrentTenant() tenantId: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.unfulfilledDemand.getSummary(
      tenantId,
      days ? Number(days) : 30,
      limit ? Number(limit) : 20,
    );

    return { success: true, data };
  }
}
