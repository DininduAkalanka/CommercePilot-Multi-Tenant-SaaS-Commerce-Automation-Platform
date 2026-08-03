import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ProductVariantService } from './product-variant.service';
import { CreateVariantDto, UpdateVariantDto } from './dto/product-variant.dto';
import { UserRole } from '@prisma/client';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

/**
 * Per-combination stock management.
 *
 * Phase 1 built the variant table, the backfill and the read switch, but left
 * no way for a shop owner to create a real variant — only SQL or a WooCommerce
 * sync could. This is the surface that makes the feature usable: telling a
 * customer "blue in L has 3" requires someone to have said so.
 *
 * Deliberately thin. Tenant scoping, duplicate rejection, soft-delete revival
 * and the negative-stock guards all live in the service, because the backfill
 * and the WooCommerce sync call it without passing through here.
 */
@ApiTags('Product Variants')
@ApiBearerAuth()
@Controller('products/:productId/variants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductVariantController {
  constructor(private readonly variants: ProductVariantService) {}

  @Get()
  @ApiOperation({ summary: 'List variants for a product' })
  @ApiResponse({ status: 200, description: 'Variants returned' })
  async list(
    // Always the authenticated tenant, never an id from the path or body —
    // trusting a request-supplied id is how two cross-tenant leaks happened.
    @CurrentTenant() tenantId: string,
    @Param('productId') productId: string,
  ) {
    const data = await this.variants.findByProduct(tenantId, productId);

    return { success: true, data };
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a variant (e.g. size L in blue)' })
  @ApiResponse({ status: 201, description: 'Variant created' })
  @ApiResponse({
    status: 400,
    description: 'This product already has a variant for that combination',
  })
  async create(
    @CurrentTenant() tenantId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    const data = await this.variants.create(tenantId, productId, dto);

    return { success: true, message: 'Variant created', data };
  }

  @Patch(':variantId')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Update a variant' })
  @ApiResponse({ status: 200, description: 'Variant updated' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('productId') _productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    const data = await this.variants.update(tenantId, variantId, dto);

    return { success: true, message: 'Variant updated', data };
  }

  @Delete(':variantId')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Remove a variant (soft delete)' })
  @ApiResponse({ status: 200, description: 'Variant removed' })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('productId') _productId: string,
    @Param('variantId') variantId: string,
  ) {
    const data = await this.variants.remove(tenantId, variantId);

    return { success: true, message: 'Variant removed', data };
  }
}
