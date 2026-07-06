import { IsString, IsNumber, IsOptional, IsObject, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Premium T-Shirt' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '100% cotton premium t-shirt' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'TSHIRT-001' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  stockQuantity: number;

  @ApiPropertyOptional({ example: { color: 'Black', size: 'L' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Premium T-Shirt' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '100% cotton premium t-shirt' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'TSHIRT-001' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ example: { color: 'Black', size: 'L' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;
}
