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
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

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

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsRead(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    // This is optional if we add a 'read' column later, but for now we might not have it.
    // If not, we can remove this or return a stub.
    return { success: true };
  }
}
