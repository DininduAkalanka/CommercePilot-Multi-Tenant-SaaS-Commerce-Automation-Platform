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
/**
 * The subset of the Prisma client this service writes through. Declaring it
 * structurally lets the same methods run against either the root client or a
 * transaction client, without importing Prisma's internal transaction types.
 */
type VariantWriteClient = {
  productVariant: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

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

  // ── PR2: backfill + dual-write ──────────────────────────────────
  //
  // Every product carries exactly one "default" variant mirroring its
  // stockQuantity. Nothing reads variants yet — PR3 switches the readers — so
  // the job here is only to make the two copies agree.
  //
  // The governing rule for all of it: the mirror must never break the path it
  // mirrors. A failure to keep variant stock in step is a stale mirror, which
  // PR2 can repair by re-running the backfill. A failure that aborts an order
  // sync loses a real customer order, which nothing can repair.

  /**
   * Create or update the default variant so it carries `stockQuantity`.
   *
   * Idempotent by design: this runs on every product create and update, so it
   * has to converge rather than accumulate. Creating blindly would hit the
   * unique index and throw an exception that fails the product save the user
   * actually asked for.
   *
   * Pass `client` to join an existing transaction. Order sync decrements
   * product stock inside one; writing the mirror outside it would leave the
   * two disagreeing whenever that transaction rolls back.
   */
  async ensureDefaultVariant(
    tenantId: string,
    productId: string,
    stockQuantity: number,
    client?: VariantWriteClient,
  ): Promise<void> {
    const db = client ?? this.prisma;

    const existing = await db.productVariant.findFirst({
      where: {
        tenantId,
        productId,
        attributeKey: ProductVariantService.DEFAULT_KEY,
      },
    });

    if (existing) {
      await db.productVariant.update({
        where: { id: existing.id },
        data: {
          stockQuantity,
          // Revive rather than collide: the unique index covers soft-deleted
          // rows, so a resurrected product would otherwise be unable to
          // regain its default variant.
          deletedAt: null,
        },
      });

      return;
    }

    await db.productVariant.create({
      data: {
        tenantId,
        productId,
        attributes: {},
        attributeKey: ProductVariantService.DEFAULT_KEY,
        stockQuantity,
        // Null price means "inherit the product price", which is exactly what
        // a default variant should do.
        price: null,
        isActive: true,
      },
    });
  }

  /**
   * Mirror a stock decrement onto the default variant.
   *
   * Deliberately swallows every failure. This is called from inside order
   * sync, and no mirror is worth losing a real order over — a stale variant
   * is repaired by re-running the backfill, a lost order is not repaired at
   * all. Nothing reads these values yet, so a miss is invisible until PR3.
   *
   * `updateMany` rather than `update` because products backfilled later may
   * legitimately have no default variant yet; matching zero rows is a normal
   * rollout state, not an error.
   */
  async decrementDefaultStock(
    tenantId: string,
    productId: string,
    quantity: number,
    client?: VariantWriteClient,
  ): Promise<void> {
    const db = client ?? this.prisma;

    try {
      const result = await db.productVariant.updateMany({
        where: {
          tenantId,
          productId,
          attributeKey: ProductVariantService.DEFAULT_KEY,
          deletedAt: null,
        },
        // Mirrors the product decrement exactly, including allowing negative
        // stock. Clamping here would make the two copies disagree, and PR3
        // would then silently change behaviour when reads switch over.
        data: { stockQuantity: { decrement: quantity } },
      });

      if (result.count === 0) {
        this.logger.debug(
          `[${tenantId}] No default variant for product ${productId} — ` +
            'skipping mirror (backfill will reconcile it)',
        );
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[${tenantId}] Failed to mirror stock decrement for product ` +
          `${productId}: ${detail}. Product stock is authoritative; ` +
          're-run the variant backfill to reconcile.',
      );
    }
  }

  /**
   * Give every product without variants a default one carrying its stock.
   *
   * Safe to re-run: it selects only products with NO variants at all, so a
   * product that already has real size/colour variants never gains a spurious
   * "default" alongside them. That matters because this runs on deploy and
   * will also be run by hand to reconcile after a failed mirror.
   *
   * Paginates rather than loading the catalogue into memory, and keeps going
   * past individual failures — one bad row must not abandon the rest.
   */
  async backfillDefaults(
    tenantId?: string,
    batchSize = 200,
  ): Promise<{ created: number; failed: number }> {
    let created = 0;
    let failed = 0;

    for (;;) {
      const products = await this.prisma.product.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          deletedAt: null,
          variants: { none: {} },
        },
        select: { id: true, tenantId: true, stockQuantity: true },
        take: batchSize,
      });

      if (products.length === 0) break;

      for (const product of products) {
        try {
          await this.prisma.productVariant.create({
            data: {
              tenantId: product.tenantId,
              productId: product.id,
              attributes: {},
              attributeKey: ProductVariantService.DEFAULT_KEY,
              stockQuantity: product.stockQuantity,
              price: null,
              isActive: true,
            },
          });
          created += 1;
        } catch (error: unknown) {
          failed += 1;
          const detail =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Backfill failed for product ${product.id}: ${detail}`,
          );
        }
      }

      // Every successful create removes a row from the next query's result
      // set. If an entire batch failed, the same rows would come back forever.
      if (created === 0 && failed >= products.length) break;
    }

    this.logger.log(
      `Variant backfill complete: ${created} created, ${failed} failed`,
    );

    return { created, failed };
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
