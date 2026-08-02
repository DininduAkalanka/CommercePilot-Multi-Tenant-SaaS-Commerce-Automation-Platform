import {
  Controller,
  Get,
  Query,
  UseGuards,
  Patch,
  Param,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all notifications with pagination' })
  @ApiResponse({ status: 200, description: 'List of notifications' })
  async getNotifications(
    @CurrentTenant() tenantId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('status') status?: string,
  ) {
    const result = await this.notificationsService.getNotifications(tenantId, {
      page: Number(page),
      limit: Number(limit),
      status,
    });
    return {
      success: true,
      data: result,
    };
  }

  /**
   * NOT YET IMPLEMENTED — accepted but not persisted.
   *
   * The `Notification` model has no read-receipt column: `NotificationStatus`
   * tracks *delivery* (PENDING/SENT/DELIVERED/FAILED), not whether the owner
   * has read the item. Persisting this requires a `readAt DateTime?` column
   * and a migration, which is deliberately out of scope here.
   *
   * The route is kept so the dashboard's optimistic UI keeps working, but the
   * response no longer claims the write succeeded — callers can branch on
   * `persisted` instead of being told `success: true` for a no-op.
   */
  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark a notification as read (accepted, not yet persisted)',
  })
  @ApiResponse({ status: 200, description: 'Request accepted; not persisted' })
  markAsRead(
    @CurrentTenant() _tenantId: string,
    @Param('id') _id: string,
  ): { success: boolean; persisted: boolean; message: string } {
    return {
      success: true,
      persisted: false,
      message:
        'Read state is not persisted yet — pending a readAt column on Notification.',
    };
  }
}
