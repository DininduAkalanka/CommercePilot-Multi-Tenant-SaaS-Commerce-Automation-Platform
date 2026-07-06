import { Controller, Post, UseGuards, Req } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ProductSyncService } from './services/product-sync.service';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations')
@UseGuards(ThrottlerGuard, JwtAuthGuard, RolesGuard)
export class IntegrationsController {
  constructor(private readonly productSyncService: ProductSyncService) {}

  /**
   * Manually trigger a synchronization of products from the configured E-commerce provider (e.g. WooCommerce).
   */
  @Post('woocommerce/sync')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.STAFF) // Allow staff to trigger sync
  @ApiOperation({ summary: 'Trigger a manual product sync from the configured provider (e.g., WooCommerce)' })
  @ApiResponse({ status: 201, description: 'Sync started/completed successfully' })
  async syncProducts(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.productSyncService.syncProducts(tenantId);
  }
}
