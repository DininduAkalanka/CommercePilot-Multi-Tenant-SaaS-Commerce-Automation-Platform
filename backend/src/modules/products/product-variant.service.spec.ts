import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductVariantService } from './product-variant.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/database/prisma.service';

/**
 * Phase 1 PR1 — per-variant stock.
 *
 * Written before the implementation. The behaviours pinned here are the ones
 * that make variant stock trustworthy: a variant always belongs to exactly one
 * tenant, one product cannot have two variants for the same combination, and
 * stock can never go negative. Everything else is detail.
 */
describe('ProductVariantService', () => {
  let service: ProductVariantService;

  // Mutable so individual tests can flip the read switch.
  let flags: Record<string, string>;

  const mockPrisma = {
    product: { findFirst: jest.fn(), findMany: jest.fn() },
    productVariant: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    flags = { VARIANT_STOCK_ENABLED: 'true' };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductVariantService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, fallback?: string) => flags[key] ?? fallback,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<ProductVariantService>(ProductVariantService);

    mockPrisma.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      price: 100,
    });
    mockPrisma.productVariant.findFirst.mockResolvedValue(null);
    mockPrisma.productVariant.findMany.mockResolvedValue([]);
    mockPrisma.productVariant.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'var-1', ...data }),
    );
    mockPrisma.productVariant.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'var-1', ...data }),
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ── attributeKey ────────────────────────────────────────────────
  describe('attributeKey', () => {
    it('is order-independent — the same combination is the same variant', () => {
      // WooCommerce, the dashboard and the AI extractor all emit these keys in
      // different orders. Without canonicalisation each would create its own
      // duplicate variant for identical stock.
      expect(
        ProductVariantService.attributeKey({ size: 'L', color: 'blue' }),
      ).toBe(ProductVariantService.attributeKey({ color: 'blue', size: 'L' }));
    });

    it('is case-insensitive on both keys and values', () => {
      expect(ProductVariantService.attributeKey({ Size: 'L' })).toBe(
        ProductVariantService.attributeKey({ size: 'l' }),
      );
    });

    it('ignores surrounding whitespace', () => {
      expect(ProductVariantService.attributeKey({ size: ' L ' })).toBe(
        ProductVariantService.attributeKey({ size: 'L' }),
      );
    });

    it('distinguishes genuinely different combinations', () => {
      expect(
        ProductVariantService.attributeKey({ size: 'L', color: 'blue' }),
      ).not.toBe(
        ProductVariantService.attributeKey({ size: 'M', color: 'blue' }),
      );
    });

    it('gives a simple product a stable default key', () => {
      // A product with no options still needs exactly one variant, and two
      // such products must not collide on the unique index.
      expect(ProductVariantService.attributeKey({})).toBe('default');
      expect(ProductVariantService.attributeKey(null)).toBe('default');
    });

    it('keeps non-string values distinct instead of collapsing them', () => {
      // Attributes arrive as JSON from WooCommerce and from the AI extractor,
      // so a value is not guaranteed to be a string. Naive stringification
      // turns every object into "[object Object]", which would merge two
      // genuinely different variants onto one key — and silently pool their
      // stock. Numbers and booleans must round-trip too.
      expect(ProductVariantService.attributeKey({ size: { v: 'L' } })).not.toBe(
        ProductVariantService.attributeKey({ size: { v: 'XL' } }),
      );

      expect(ProductVariantService.attributeKey({ size: 42 })).toBe('size=42');
      expect(ProductVariantService.attributeKey({ gift: true })).toBe(
        'gift=true',
      );
    });

    it('drops empty values rather than encoding them', () => {
      // "size not chosen" is not a different variant from "no size at all".
      expect(ProductVariantService.attributeKey({ size: 'L', color: '' })).toBe(
        ProductVariantService.attributeKey({ size: 'L' }),
      );
    });
  });

  // ── create ──────────────────────────────────────────────────────
  describe('create', () => {
    it('stores the canonical key alongside the raw attributes', async () => {
      await service.create('tenant-1', 'prod-1', {
        attributes: { color: 'Blue', size: 'L' },
        stockQuantity: 5,
      });

      expect(mockPrisma.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'prod-1',
          attributes: { color: 'Blue', size: 'L' }, // raw, for display
          attributeKey: 'color=blue|size=l', // canonical, for uniqueness
          stockQuantity: 5,
        }),
      });
    });

    it('refuses a product belonging to another tenant', async () => {
      // The audit found two cross-tenant leaks from exactly this omission.
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.create('tenant-1', 'someone-elses-product', {
          attributes: { size: 'L' },
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.productVariant.create).not.toHaveBeenCalled();
    });

    it('scopes the product lookup to the calling tenant', async () => {
      await service.create('tenant-1', 'prod-1', { attributes: { size: 'L' } });

      expect(mockPrisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', tenantId: 'tenant-1', deletedAt: null },
      });
    });

    it('rejects a second variant for the same combination', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'existing',
        deletedAt: null,
      });

      await expect(
        service.create('tenant-1', 'prod-1', { attributes: { size: 'L' } }),
      ).rejects.toThrow(BadRequestException);
    });

    it('revives a soft-deleted variant instead of colliding with it', async () => {
      // The unique index covers soft-deleted rows too, so re-adding a
      // previously removed size would otherwise fail with a constraint error
      // the owner cannot act on.
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-old',
        deletedAt: new Date(),
      });

      await service.create('tenant-1', 'prod-1', {
        attributes: { size: 'L' },
        stockQuantity: 7,
      });

      expect(mockPrisma.productVariant.create).not.toHaveBeenCalled();
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-old' },
        data: expect.objectContaining({ deletedAt: null, stockQuantity: 7 }),
      });
    });

    it('rejects negative stock', async () => {
      await expect(
        service.create('tenant-1', 'prod-1', {
          attributes: { size: 'L' },
          stockQuantity: -1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative price', async () => {
      await expect(
        service.create('tenant-1', 'prod-1', {
          attributes: { size: 'L' },
          price: -5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults stock to zero rather than guessing', async () => {
      await service.create('tenant-1', 'prod-1', { attributes: { size: 'L' } });

      expect(mockPrisma.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stockQuantity: 0 }),
      });
    });

    it('leaves price null so the variant inherits the product price', async () => {
      await service.create('tenant-1', 'prod-1', { attributes: { size: 'L' } });

      const data = mockPrisma.productVariant.create.mock.calls[0][0].data;
      expect(data.price ?? null).toBeNull();
    });
  });

  // ── read ────────────────────────────────────────────────────────
  describe('findByProduct', () => {
    it('returns only this tenant’s live variants', async () => {
      await service.findByProduct('tenant-1', 'prod-1');

      expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            productId: 'prod-1',
            deletedAt: null,
          },
        }),
      );
    });
  });

  describe('findByAttributes', () => {
    it('matches regardless of how the attributes were written', async () => {
      await service.findByAttributes('tenant-1', 'prod-1', {
        Color: 'BLUE',
        size: ' l ',
      });

      expect(mockPrisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          productId: 'prod-1',
          attributeKey: 'color=blue|size=l',
          deletedAt: null,
        },
      });
    });
  });

  // ── update / delete ─────────────────────────────────────────────
  describe('update', () => {
    it('refuses a variant belonging to another tenant', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.update('tenant-1', 'someone-elses-variant', {
          stockQuantity: 3,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects negative stock on update too', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({ id: 'var-1' });

      await expect(
        service.update('tenant-1', 'var-1', { stockQuantity: -2 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recomputes the canonical key when attributes change', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-1',
        productId: 'prod-1',
      });

      await service.update('tenant-1', 'var-1', {
        attributes: { size: 'XL', color: 'Red' },
      });

      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        data: expect.objectContaining({ attributeKey: 'color=red|size=xl' }),
      });
    });
  });

  describe('remove', () => {
    it('soft-deletes so order history keeps resolving', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({ id: 'var-1' });

      await service.remove('tenant-1', 'var-1');

      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      });
    });

    it('refuses a variant belonging to another tenant', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(service.remove('tenant-1', 'var-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── PR2: backfill + dual-write ──────────────────────────────────
  //
  // Every product gets exactly one "default" variant mirroring its
  // stockQuantity. Nothing reads variants yet (that is PR3), so the only job
  // here is to make the two copies agree — and to never let the mirror break
  // the path it mirrors.
  describe('ensureDefaultVariant', () => {
    it('creates the default variant carrying the product stock', async () => {
      await service.ensureDefaultVariant('tenant-1', 'prod-1', 12);

      expect(mockPrisma.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'prod-1',
          attributeKey: 'default',
          stockQuantity: 12,
        }),
      });
    });

    it('updates the existing default instead of creating a second one', async () => {
      // Called on every product update, so it must converge rather than
      // accumulate. The unique index would reject a duplicate anyway, and that
      // exception would fail the product save the user actually asked for.
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-default',
        attributeKey: 'default',
      });

      await service.ensureDefaultVariant('tenant-1', 'prod-1', 7);

      expect(mockPrisma.productVariant.create).not.toHaveBeenCalled();
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-default' },
        data: expect.objectContaining({ stockQuantity: 7 }),
      });
    });

    it('looks the variant up scoped to the tenant', async () => {
      await service.ensureDefaultVariant('tenant-1', 'prod-1', 1);

      expect(mockPrisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          productId: 'prod-1',
          attributeKey: 'default',
        },
      });
    });

    it('revives a soft-deleted default rather than colliding with it', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-default',
        deletedAt: new Date(),
      });

      await service.ensureDefaultVariant('tenant-1', 'prod-1', 4);

      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-default' },
        data: expect.objectContaining({ stockQuantity: 4, deletedAt: null }),
      });
    });

    it('uses the transaction client when one is supplied', async () => {
      // Order sync decrements product stock inside a transaction. Writing the
      // mirror outside it would leave the two disagreeing whenever that
      // transaction rolls back.
      const tx = {
        productVariant: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      await service.ensureDefaultVariant('tenant-1', 'prod-1', 3, tx as never);

      expect(tx.productVariant.create).toHaveBeenCalled();
      expect(mockPrisma.productVariant.create).not.toHaveBeenCalled();
    });
  });

  describe('decrementDefaultStock', () => {
    it('decrements the default variant', async () => {
      mockPrisma.productVariant.updateMany.mockResolvedValue({ count: 1 });

      await service.decrementDefaultStock('tenant-1', 'prod-1', 2);

      expect(mockPrisma.productVariant.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          productId: 'prod-1',
          attributeKey: 'default',
          deletedAt: null,
        },
        data: { stockQuantity: { decrement: 2 } },
      });
    });

    it('does nothing when the product has no default variant yet', async () => {
      // During rollout some products are not backfilled. Order sync must still
      // complete: losing a real customer order to keep a mirror tidy would be
      // a far worse failure than the mirror being stale.
      mockPrisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.decrementDefaultStock('tenant-1', 'prod-1', 2),
      ).resolves.not.toThrow();
    });

    it('never throws into the caller, even on a database error', async () => {
      mockPrisma.productVariant.updateMany.mockRejectedValue(
        new Error('deadlock'),
      );

      await expect(
        service.decrementDefaultStock('tenant-1', 'prod-1', 1),
      ).resolves.not.toThrow();
    });
  });

  describe('backfillDefaults', () => {
    it('creates one default variant per product that has none', async () => {
      mockPrisma.product.findMany.mockResolvedValueOnce([
        { id: 'p1', tenantId: 't1', stockQuantity: 5 },
        { id: 'p2', tenantId: 't1', stockQuantity: 0 },
      ]);
      mockPrisma.product.findMany.mockResolvedValueOnce([]);

      const result = await service.backfillDefaults();

      expect(result.created).toBe(2);
      expect(mockPrisma.productVariant.create).toHaveBeenCalledTimes(2);
    });

    it('only selects products with no variants at all', async () => {
      // Idempotency is the whole point: this runs on deploy and may be re-run
      // by hand. A product that already has real variants must never gain a
      // spurious "default" alongside them.
      mockPrisma.product.findMany.mockResolvedValueOnce([]);

      await service.backfillDefaults();

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            variants: { none: {} },
          }),
        }),
      );
    });

    it('carries each product current stock onto its variant', async () => {
      mockPrisma.product.findMany.mockResolvedValueOnce([
        { id: 'p1', tenantId: 't1', stockQuantity: 9 },
      ]);
      mockPrisma.product.findMany.mockResolvedValueOnce([]);

      await service.backfillDefaults();

      expect(mockPrisma.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stockQuantity: 9,
          attributeKey: 'default',
        }),
      });
    });

    it('can be scoped to one tenant', async () => {
      mockPrisma.product.findMany.mockResolvedValueOnce([]);

      await service.backfillDefaults('tenant-1');

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1' }),
        }),
      );
    });

    it('keeps going when one product fails', async () => {
      // A single bad row must not abandon the rest of the catalogue.
      mockPrisma.product.findMany.mockResolvedValueOnce([
        { id: 'p1', tenantId: 't1', stockQuantity: 1 },
        { id: 'p2', tenantId: 't1', stockQuantity: 2 },
      ]);
      mockPrisma.product.findMany.mockResolvedValueOnce([]);
      mockPrisma.productVariant.create
        .mockRejectedValueOnce(new Error('constraint'))
        .mockResolvedValueOnce({ id: 'v2' });

      const result = await service.backfillDefaults();

      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  // ── PR3: switch reads ───────────────────────────────────────────
  //
  // The dangerous step. Until now variants were written but never read, so a
  // wrong value was invisible. From here a wrong value tells a customer their
  // size is available when it is not.
  //
  // Hence the rule below: resolveStock falls back to the product's own stock
  // for ANY doubt — flag off, no variant row, or a lookup failure. Falling
  // back reproduces today's behaviour exactly, which is known-good. Returning
  // 0 on doubt would silently refuse orders the shop can actually fulfil.
  describe('resolveStock', () => {
    it('returns the variant stock when the flag is on and a variant exists', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'v1',
        stockQuantity: 3,
      });

      const stock = await service.resolveStock('tenant-1', 'prod-1', 12);

      expect(stock).toBe(3);
    });

    it('returns the product stock when the flag is off, without querying', async () => {
      // The flag has to be a genuine kill switch: if a bad backfill is
      // discovered in production, flipping it must restore old behaviour with
      // no deploy and no database access.
      flags.VARIANT_STOCK_ENABLED = 'false';

      const stock = await service.resolveStock('tenant-1', 'prod-1', 12);

      expect(stock).toBe(12);
      expect(mockPrisma.productVariant.findFirst).not.toHaveBeenCalled();
    });

    it('defaults to OFF when the flag is unset', async () => {
      // A read switch must never enable itself. Anyone deploying without
      // running the backfill first would otherwise see every product report
      // zero stock.
      delete flags.VARIANT_STOCK_ENABLED;

      const stock = await service.resolveStock('tenant-1', 'prod-1', 12);

      expect(stock).toBe(12);
      expect(mockPrisma.productVariant.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to product stock when the product has no variant row', async () => {
      // A product created between the backfill running and this deploy has no
      // mirror yet. Reporting 0 would refuse an order the shop can fulfil.
      mockPrisma.productVariant.findFirst.mockResolvedValue(null);

      const stock = await service.resolveStock('tenant-1', 'prod-1', 12);

      expect(stock).toBe(12);
    });

    it('falls back to product stock when the lookup throws', async () => {
      mockPrisma.productVariant.findFirst.mockRejectedValue(
        new Error('connection lost'),
      );

      const stock = await service.resolveStock('tenant-1', 'prod-1', 12);

      expect(stock).toBe(12);
    });

    it('resolves a specific combination when attributes are given', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'v1',
        stockQuantity: 2,
      });

      await service.resolveStock('tenant-1', 'prod-1', 12, {
        Color: 'BLUE',
        size: ' l ',
      });

      expect(mockPrisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          productId: 'prod-1',
          attributeKey: 'color=blue|size=l',
          deletedAt: null,
        },
      });
    });

    it('uses the default variant when no attributes are given', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'v1',
        stockQuantity: 5,
      });

      await service.resolveStock('tenant-1', 'prod-1', 12);

      expect(mockPrisma.productVariant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ attributeKey: 'default' }),
        }),
      );
    });

    it('reports zero when the variant genuinely has zero stock', async () => {
      // Zero is a real answer, not a missing one — it must not be mistaken for
      // "no variant" and replaced by the product total. This is the whole
      // point of the feature: "blue in L is sold out" while the shirt is not.
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'v1',
        stockQuantity: 0,
      });

      const stock = await service.resolveStock('tenant-1', 'prod-1', 12);

      expect(stock).toBe(0);
    });
  });

  describe('resolveStockMany', () => {
    it('resolves a whole catalogue page in one query', async () => {
      // RAG context lists top-K products. One query per product would add K
      // round trips to every customer message.
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { productId: 'p1', stockQuantity: 3 },
        { productId: 'p2', stockQuantity: 0 },
      ]);

      const result = await service.resolveStockMany('tenant-1', [
        { productId: 'p1', fallbackStock: 10 },
        { productId: 'p2', fallbackStock: 20 },
        { productId: 'p3', fallbackStock: 30 },
      ]);

      expect(mockPrisma.productVariant.findMany).toHaveBeenCalledTimes(1);
      expect(result.get('p1')).toBe(3);
      expect(result.get('p2')).toBe(0);
      // p3 has no mirror row — falls back rather than reporting zero
      expect(result.get('p3')).toBe(30);
    });

    it('returns every fallback untouched when the flag is off', async () => {
      flags.VARIANT_STOCK_ENABLED = 'false';

      const result = await service.resolveStockMany('tenant-1', [
        { productId: 'p1', fallbackStock: 10 },
      ]);

      expect(result.get('p1')).toBe(10);
      expect(mockPrisma.productVariant.findMany).not.toHaveBeenCalled();
    });

    it('falls back for every product when the query fails', async () => {
      mockPrisma.productVariant.findMany.mockRejectedValue(new Error('down'));

      const result = await service.resolveStockMany('tenant-1', [
        { productId: 'p1', fallbackStock: 10 },
        { productId: 'p2', fallbackStock: 20 },
      ]);

      expect(result.get('p1')).toBe(10);
      expect(result.get('p2')).toBe(20);
    });

    it('handles an empty list without querying', async () => {
      const result = await service.resolveStockMany('tenant-1', []);

      expect(result.size).toBe(0);
      expect(mockPrisma.productVariant.findMany).not.toHaveBeenCalled();
    });
  });
});
