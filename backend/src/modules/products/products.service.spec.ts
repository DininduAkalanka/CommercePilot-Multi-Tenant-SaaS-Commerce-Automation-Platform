import { Test, TestingModule } from '@nestjs/testing';
import { ProductVariantService } from './product-variant.service';
import { ProductsService } from './products.service';
import { PrismaService } from '../../common/database/prisma.service';
import { ProductRetrieverService } from '../ai-engine/pipeline/product-retriever.service';
import { NotFoundException } from '@nestjs/common';

describe('ProductsService', () => {
  const mockVariants = { ensureDefaultVariant: jest.fn() };

  let service: ProductsService;

  const mockPrisma = {
    product: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    softDelete: jest.fn(),
  };

  const mockProductRetriever = {
    generateAndStoreEmbedding: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: ProductVariantService, useValue: mockVariants },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProductRetrieverService, useValue: mockProductRetriever },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createProduct', () => {
    it('should create a product and trigger embedding generation', async () => {
      const tenantId = 'tenant-1';
      const dto = {
        name: 'Test Product',
        description: 'A great product',
        price: 1500,
        stockQuantity: 10,
      };

      const createdProduct = { id: 'prod-1', tenantId, ...dto, isActive: true };
      mockPrisma.product.create.mockResolvedValue(createdProduct);

      const result = await service.createProduct(tenantId, dto);

      expect(result).toEqual(createdProduct);
      expect(mockPrisma.product.create).toHaveBeenCalledTimes(1);
      // Should trigger async embedding generation
      expect(mockProductRetriever.generateAndStoreEmbedding).toHaveBeenCalled();
    });
  });

  describe('getProducts', () => {
    it('should return paginated products', async () => {
      const tenantId = 'tenant-1';
      const mockProducts = [
        { id: 'prod-1', name: 'Product A' },
        { id: 'prod-2', name: 'Product B' },
      ];
      mockPrisma.product.findMany.mockResolvedValue(mockProducts);
      mockPrisma.product.count.mockResolvedValue(2);

      const result = await service.getProducts(tenantId, 1, 20);

      expect(result.products).toEqual(mockProducts);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, deletedAt: null },
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(25);

      const result = await service.getProducts('tenant-1', 2, 10);

      expect(result.totalPages).toBe(3);
      expect(result.page).toBe(2);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('getProduct', () => {
    it('should return a product by id', async () => {
      const mockProduct = { id: 'prod-1', tenantId: 'tenant-1', name: 'Test' };
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);

      const result = await service.getProduct('tenant-1', 'prod-1');

      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException for missing product', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.getProduct('tenant-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProduct', () => {
    it('should update a product and regenerate embedding', async () => {
      const mockProduct = {
        id: 'prod-1',
        tenantId: 'tenant-1',
        name: 'Old Name',
      };
      const updatedProduct = { ...mockProduct, name: 'New Name' };

      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);
      mockPrisma.product.update.mockResolvedValue(updatedProduct);

      const result = await service.updateProduct('tenant-1', 'prod-1', {
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
      expect(
        mockProductRetriever.generateAndStoreEmbedding,
      ).toHaveBeenCalledWith('prod-1', 'tenant-1');
    });
  });

  describe('deleteProduct', () => {
    it('should soft-delete a product', async () => {
      const mockProduct = { id: 'prod-1', tenantId: 'tenant-1', name: 'Test' };
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);
      mockPrisma.softDelete.mockResolvedValue(undefined);

      const result = await service.deleteProduct('tenant-1', 'prod-1');

      expect(result).toEqual({
        success: true,
        message: 'Product deleted successfully',
      });
      expect(mockPrisma.softDelete).toHaveBeenCalledWith('product', {
        id: 'prod-1',
      });
    });

    it('should throw NotFoundException when deleting non-existent product', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteProduct('tenant-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Phase 1 PR2: dual-write ─────────────────────────────────────
  describe('default variant mirror', () => {
    it('mirrors stock onto the default variant when a product is created', async () => {
      // Without this the backfill would be the only thing populating variants,
      // so every product created after it ran would be missing from the mirror
      // — and PR3 would then read zero stock for exactly the newest products.
      await service.createProduct('tenant-1', {
        name: 'Blue Shirt',
        price: 100,
        stockQuantity: 12,
      });

      // The PERSISTED value, not the DTO's — defaults and coercion happen at
      // write time, and mirroring the request instead of the row is how the
      // two copies drift apart.
      expect(mockVariants.ensureDefaultVariant).toHaveBeenCalledWith(
        'tenant-1',
        'prod-1',
        10,
      );
    });

    it('mirrors stock onto the default variant when a product is updated', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        tenantId: 'tenant-1',
        stockQuantity: 10,
      });
      // Prisma returns the updated row; the mirror reads its stock from there
      // rather than from the DTO, so the mock has to model that.
      mockPrisma.product.update.mockResolvedValue({
        id: 'prod-1',
        tenantId: 'tenant-1',
        stockQuantity: 3,
      });

      await service.updateProduct('tenant-1', 'prod-1', {
        stockQuantity: 3,
      });

      expect(mockVariants.ensureDefaultVariant).toHaveBeenCalledWith(
        'tenant-1',
        'prod-1',
        3,
      );
    });
  });
});
