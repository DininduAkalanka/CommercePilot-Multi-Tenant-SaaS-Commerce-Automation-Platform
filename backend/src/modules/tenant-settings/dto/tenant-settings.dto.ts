import { IsString, IsOptional, IsBoolean, IsNumber, Min, Max, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({ description: 'Business name' })
  @IsOptional()
  @IsString()
  name?: string;

  // WhatsApp configuration
  @ApiPropertyOptional({ description: 'WhatsApp Phone Number ID' })
  @IsOptional()
  @IsString()
  whatsappPhoneNumberId?: string;

  @ApiPropertyOptional({ description: 'WhatsApp Access Token' })
  @IsOptional()
  @IsString()
  whatsappAccessToken?: string;

  @ApiPropertyOptional({ description: 'WhatsApp Verify Token' })
  @IsOptional()
  @IsString()
  whatsappVerifyToken?: string;

  // WooCommerce configuration
  @ApiPropertyOptional({ description: 'WooCommerce Store URL' })
  @IsOptional()
  @IsString()
  woocommerceUrl?: string;

  @ApiPropertyOptional({ description: 'WooCommerce API Key' })
  @IsOptional()
  @IsString()
  woocommerceKey?: string;

  @ApiPropertyOptional({ description: 'WooCommerce API Secret' })
  @IsOptional()
  @IsString()
  woocommerceSecret?: string;

  // AI Configuration
  @ApiPropertyOptional({ description: 'AI Confidence Threshold (0 to 1)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  aiConfidenceThreshold?: number;

  @ApiPropertyOptional({ description: 'Enable Auto Approval of AI Drafts' })
  @IsOptional()
  @IsBoolean()
  autoApproveEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Auto Approval Threshold (0 to 1)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  autoApproveThreshold?: number;

  @ApiPropertyOptional({ description: 'Business Hours configuration' })
  @IsOptional()
  @IsObject()
  businessHours?: Record<string, any>;
}
