import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Coerce a numeric field that may arrive as a string.
 *
 * Prisma serialises `Decimal` columns to JSON strings, so a price the API
 * returned as "25.00" comes straight back from the dashboard as a string.
 * The global ValidationPipe sets `enableImplicitConversion`, but that relies
 * on the emitted design:type — and for a union like `number | null` TypeScript
 * emits `Object`, so no conversion happens and `@IsNumber()` rejects the value.
 *
 * null/undefined/'' are passed through untouched so `@IsOptional()` still sees
 * them as absent; a bare `@Type(() => Number)` would turn null into 0 and
 * silently zero out a price.
 */
const ToNumber = () =>
  Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined || value === ''
      ? value
      : Number(value),
  );

/**
 * A single corrected line item.
 *
 * `matched_product_id` is validated as a UUID because it is used to look up a
 * product and copy its price onto the draft. Validation alone is not the
 * security control — the lookup in OrdersService is tenant-scoped — but it
 * stops malformed input from reaching the query in the first place.
 */
export class CorrectedDraftItemDto {
  @ApiPropertyOptional({ description: 'Original customer phrasing' })
  @IsOptional()
  @IsString()
  product_query?: string;

  @ApiPropertyOptional({
    description: 'ID of the catalog product this line resolves to',
  })
  @IsOptional()
  @IsUUID()
  matched_product_id?: string | null;

  @ApiPropertyOptional({ description: 'Display name of the matched product' })
  @IsOptional()
  @IsString()
  matched_product_name?: string | null;

  @ApiPropertyOptional({ description: 'Match confidence, 0..1' })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(0)
  match_confidence?: number;

  @ApiProperty({ description: 'Quantity ordered', minimum: 1 })
  @ToNumber()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: 'Unit price; defaults to catalog price' })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;

  @ApiPropertyOptional({ description: 'Chosen variant attributes' })
  @IsOptional()
  @IsObject()
  selected_attributes?: Record<string, unknown>;
}

export class CorrectedDeliveryInfoDto {
  @ApiPropertyOptional({ description: 'Delivery address' })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({ description: 'Requested delivery date' })
  @IsOptional()
  @IsString()
  requested_date?: string | null;

  @ApiPropertyOptional({ description: 'Delivery notes' })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

/**
 * The owner's corrected view of an AI draft.
 *
 * This was previously typed as `Record<string, unknown>`, which meant the
 * global ValidationPipe had no metadata to work with and skipped the payload
 * entirely — `items[]` reached the database layer completely unchecked.
 */
export class CorrectedDataDto {
  @ApiProperty({ type: [CorrectedDraftItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CorrectedDraftItemDto)
  items: CorrectedDraftItemDto[];

  @ApiPropertyOptional({ type: CorrectedDeliveryInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CorrectedDeliveryInfoDto)
  delivery_info?: CorrectedDeliveryInfoDto;

  @ApiPropertyOptional({ description: 'Fields still missing after correction' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missing_fields?: string[];

  @ApiPropertyOptional({ description: 'Free-text notes from the customer' })
  @IsOptional()
  @IsString()
  customer_notes?: string | null;
}

/**
 * CorrectDraftDto
 *
 * Payload sent when an owner edits a draft order's AI-extracted data
 * before approving. The corrected data is diffed against the original
 * and stored in AIDraftOrder.humanCorrections for AI training signals.
 */
export class CorrectDraftDto {
  @ApiProperty({
    type: CorrectedDataDto,
    description: 'The corrected data fields for the draft order',
  })
  @ValidateNested()
  @Type(() => CorrectedDataDto)
  correctedData: CorrectedDataDto;
}
