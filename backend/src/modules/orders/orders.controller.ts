import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CorrectDraftDto } from './dto/correct-draft.dto';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole, OrderStatus } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';

class ApproveOrderDto {
  @ApiProperty({ description: 'Optional notes for the approval', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

class RejectOrderDto {
  @ApiProperty({ description: 'Reason for rejecting the order draft' })
  @IsString()
  reason: string;
}

/**
 * OrdersController
 *
 * All routes require authentication.
 * Approval/rejection requires OWNER role.
 */
@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** Real-time order events subscription stream */
  @Sse('events')
  @ApiOperation({ summary: 'Real-time order events (SSE)' })
  events(@CurrentTenant() tenantId: string): Observable<MessageEvent> {
    return this.ordersService.getSseObservable(tenantId);
  }

  /** Dashboard KPI stats */
  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard KPI statistics' })
  async getStats(@CurrentTenant() tenantId: string) {
    const stats = await this.ordersService.getDashboardStats(tenantId);
    return { success: true, data: stats };
  }

  /** Dashboard recent activity feed */
  @Get('recent-activity')
  @ApiOperation({ summary: 'Get recent activity feed' })
  async getRecentActivity(@CurrentTenant() tenantId: string) {
    const activity = await this.ordersService.getRecentActivity(tenantId);
    return { success: true, data: activity };
  }

  /** Analytics data for charts — daily orders, status breakdown, AI metrics */
  @Get('analytics')
  @ApiOperation({ summary: 'Get analytics data for charts (30-day window)' })
  @ApiResponse({ status: 200, description: 'Analytics data including daily order volume, status breakdown, and AI metrics' })
  async getAnalytics(@CurrentTenant() tenantId: string) {
    const data = await this.ordersService.getAnalytics(tenantId);
    return { success: true, data };
  }

  /** Pending AI draft orders awaiting owner approval */
  @Get('drafts')
  @ApiOperation({ summary: 'Get pending AI draft orders awaiting approval' })
  async getPendingDrafts(@CurrentTenant() tenantId: string) {
    const drafts = await this.ordersService.getPendingDrafts(tenantId);
    return { success: true, data: drafts };
  }

  /** Get a specific draft with AI processing logs */
  @Get('drafts/:id')
  @ApiOperation({ summary: 'Get a specific draft with AI processing logs' })
  async getDraft(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const result = await this.ordersService.getDraftById(tenantId, id);
    return { success: true, data: result };
  }

  /** Approve a draft order — OWNER only */
  @Patch('drafts/:id/approve')
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a draft order (OWNER only)' })
  @ApiResponse({ status: 200, description: 'Order approved' })
  async approveDraft(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApproveOrderDto,
  ) {
    const order = await this.ordersService.approveDraft(
      tenantId,
      id,
      user.sub,
      dto.notes,
    );
    return { success: true, message: 'Order approved', data: order };
  }

  /** Reject a draft order — OWNER only */
  @Patch('drafts/:id/reject')
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a draft order (OWNER only)' })
  @ApiResponse({ status: 200, description: 'Order rejected' })
  async rejectDraft(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RejectOrderDto,
  ) {
    const result = await this.ordersService.rejectDraft(
      tenantId,
      id,
      user.sub,
      dto.reason,
    );
    return { success: true, message: 'Order rejected', data: result };
  }

  /** Get all confirmed orders with pagination */
  @Get()
  @ApiOperation({ summary: 'Get all confirmed orders with pagination' })
  async getOrders(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.ordersService.getOrders(tenantId, {
      status,
      page,
      limit,
    });
    return { success: true, data: result };
  }

  /**
   * Record owner corrections to an AI draft before approval.
   * Stores the diff as a training signal in AIDraftOrder.humanCorrections.
   *
   * PATCH /api/v1/orders/drafts/:id/correct
   */
  @Patch('drafts/:id/correct')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record human corrections to an AI draft' })
  async correctDraft(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') draftId: string,
    @Body() dto: CorrectDraftDto,
  ) {
    await this.ordersService.saveDraftCorrections(
      tenantId,
      draftId,
      dto.correctedData,
      user.sub,
    );
    return { success: true, message: 'Corrections saved. Draft is ready for approval.' };
  }
}

