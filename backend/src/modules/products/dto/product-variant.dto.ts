import {
  IsObject,
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Validation mirrors `ProductVariantService`'s guards rather than replacing
 * them. The DTO rejects bad input early with a clear field-level message; the
 * service still enforces the same rules, because it is also called by the
 * WooCommerce sync and the backfill, which never pass through a DTO.
 */
export class CreateVariantDto {
  @ApiProperty({
    description: 'The chosen options for this variant',
    example: { size: 'L', color: 'blue' },
  })
  @IsObject()
  attributes!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'SHIRT-BLUE-L' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @ApiPropertyOptional({
    description: 'Leave null to inherit the product price',
    example: 1500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ example: 3, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  // Negative stock is not a quantity, it is a bug upstream. Rejecting it here
  // keeps it out of the mirror that order validation reads.
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVariantDto {
  @ApiPropertyOptional({ example: { size: 'XL', color: 'red' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
