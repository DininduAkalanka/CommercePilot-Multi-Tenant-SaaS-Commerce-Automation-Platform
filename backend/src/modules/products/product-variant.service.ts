import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { Prisma } from '@prisma/client';

export type VariantAttributes = Record<string, unknown> | null | undefined;

export interface CreateVariantInput {
  attributes: VariantAttributes;
  sku?: string | null;
  price?: number | null;
  stockQuantity?: number;
  woocommerceId?: string | null;
  isActive?: boolean;
}

export interface UpdateVariantInput {
  attributes?: VariantAttributes;
  sku?: string | null;
  price?: number | null;
  stockQuantity?: number;
  woocommerceId?: string | null;
  isActive?: boolean;
}

/**
 * ProductVariantService
 *
 * Phase 1 — per-combination stock.
 *
 * `Product.stockQuantity` is a single integer and `Product.attributes` merely
 * lists which options exist. The catalog can therefore say "this shirt has 12
 * units" but never "blue in L has 3". Answering that question wrongly is worse
 * than not answering it: it promises stock that cannot ship, which is the
 * exact trust failure the human-approval design exists to prevent.
 *
 * Nothing in the order pipeline reads variants yet — that is PR3. This service
 * exists so the backfill (PR2) and the read switch have a tested, tenant-safe
 * way to manage them.
 */
@Injectable()
export class ProductVariantService {
  private readonly logger = new Logger(ProductVariantService.name);

  /** Key used for a product with no options at all. */
  private static readonly DEFAULT_KEY = 'default';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Canonical form of an attribute set: sorted, lowercased, `color=blue|size=l`.
   *
   * WooCommerce, the dashboard and the AI extractor all describe the same
   * variant differently — `{size:"L",color:"blue"}` vs `{color:"Blue",size:"l"}`.
   * Comparing raw JSON would treat those as different variants and split one
   * product's stock across duplicates. This key is stored so the DATABASE can
   * enforce uniqueness, rather than relying on every write path remembering to
   * check.
   *
   * Empty values are dropped: "size not chosen" is not a different variant
   * from "no size at all".
   */
  static attributeKey(attributes: VariantAttributes): string {
    if (!attributes || typeof attributes !== 'object') {
      return ProductVariantService.DEFAULT_KEY;
    }

    const parts = Object.entries(attributes)
      .map(([key, value]) => [
        key.trim().toLowerCase(),
        ProductVariantService.normaliseValue(value),
      ])
      .filter(([key, value]) => key !== '' && value !== '')
      .map(([key, value]) => `${key}=${value}`)
      .sort();

    return parts.length > 0
      ? parts.join('|')
      : ProductVariantService.DEFAULT_KEY;
  }

  /**
   * Reduce one attribute value to a comparable string.
   *
   * Attributes arrive as JSON — from WooCommerce, from the dashboard, from the
   * AI extractor — so a value is not guaranteed to be a string. `String(value)`
   * renders every object as `[object Object]`, which would give two genuinely
   * different variants the same key and pool their stock into one row. Objects
   * are therefore serialised, not stringified.
   */
  private static normaliseValue(value: unknown): string {
    if (value === null || value === undefined) return '';

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value).trim().toLowerCase();
    }

    // Malformed for an attribute, but distinctness matters more than shape:
    // better an ugly key than two variants silently merged.
    try {
      return JSON.stringify(value).trim().toLowerCase();
    } catch {
      return '';
    }
  }

  async create(tenantId: string, productId: string, input: CreateVariantInput) {
    this.assertStock(input.stockQuantity);
    this.assertPrice(input.price);

    // Tenant-scoped on purpose. An unscoped lookup here is how two
    // cross-tenant leaks reached production before.
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(`Product not found: ${productId}`);
    }

    const attributeKey = ProductVariantService.attributeKey(input.attributes);
    const existing = await this.prisma.productVariant.findFirst({
      where: { tenantId, productId, attributeKey },
    });

    if (existing && !existing.deletedAt) {
      throw new BadRequestException(
        `This product already has a variant for ${attributeKey}`,
      );
    }

    const data = {
      attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
      attributeKey,
      sku: input.sku ?? null,
      price: input.price ?? null,
      stockQuantity: input.stockQuantity ?? 0,
      woocommerceId: input.woocommerceId ?? null,
      isActive: input.isActive ?? true,
    };

    // The unique index covers soft-deleted rows, so re-adding a size that was
    // previously removed would fail with a constraint error the owner cannot
    // act on. Revive the old row instead.
    if (existing) {
      this.logger.log(
        `[${tenantId}] Reviving soft-deleted variant ${existing.id} (${attributeKey})`,
      );

      return this.prisma.productVariant.update({
        where: { id: existing.id },
        data: { ...data, deletedAt: null },
      });
    }

    return this.prisma.productVariant.create({
      data: { tenantId, productId, ...data },
    });
  }

  async findByProduct(tenantId: string, productId: string) {
    return this.prisma.productVariant.findMany({
      where: { tenantId, productId, deletedAt: null },
      orderBy: { attributeKey: 'asc' },
    });
  }

  /**
   * Look a variant up by the options a customer asked for, however they were
   * written. This is what PR3's stock validation will call.
   */
  async findByAttributes(
    tenantId: string,
    productId: string,
    attributes: VariantAttributes,
  ) {
    return this.prisma.productVariant.findFirst({
      where: {
        tenantId,
        productId,
        attributeKey: ProductVariantService.attributeKey(attributes),
        deletedAt: null,
      },
    });
  }

  async update(tenantId: string, variantId: string, input: UpdateVariantInput) {
    this.assertStock(input.stockQuantity);
    this.assertPrice(input.price);

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId, deletedAt: null },
    });

    if (!variant) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
    }

    const data: Prisma.ProductVariantUpdateInput = {};

    // The canonical key must never drift from the attributes it describes, so
    // it is always recomputed rather than accepted from the caller.
    if (input.attributes !== undefined) {
      data.attributes = (input.attributes ?? {}) as Prisma.InputJsonValue;
      data.attributeKey = ProductVariantService.attributeKey(input.attributes);
    }
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.price !== undefined) data.price = input.price;
    if (input.stockQuantity !== undefined) {
      data.stockQuantity = input.stockQuantity;
    }
    if (input.woocommerceId !== undefined) {
      data.woocommerceId = input.woocommerceId;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data,
    });
  }

  /**
   * Soft delete. Order history references variants, so a hard delete would
   * leave past orders unable to say what was actually sold.
   */
  async remove(tenantId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId, deletedAt: null },
    });

    if (!variant) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
    }

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // ── Guards ──────────────────────────────────────────────────────

  private assertStock(stockQuantity?: number): void {
    if (stockQuantity === undefined) return;

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      throw new BadRequestException(
        'stockQuantity must be a non-negative whole number',
      );
    }
  }

  private assertPrice(price?: number | null): void {
    if (price === undefined || price === null) return;

    if (!Number.isFinite(price) || price < 0) {
      throw new BadRequestException('price must be a non-negative number');
    }
  }
}
