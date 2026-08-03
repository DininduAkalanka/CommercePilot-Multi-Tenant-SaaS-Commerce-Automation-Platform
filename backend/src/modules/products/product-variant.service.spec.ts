import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductVariantService } from './product-variant.service';
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

  const mockPrisma = {
    product: { findFirst: jest.fn() },
    productVariant: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductVariantService,
        { provide: PrismaService, useValue: mockPrisma },
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
});
