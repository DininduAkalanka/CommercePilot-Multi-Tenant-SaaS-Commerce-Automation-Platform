import { Test, TestingModule } from '@nestjs/testing';
import { ProductSyncService } from './product-sync.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { ProductRetrieverService } from '../../ai-engine/pipeline/product-retriever.service';
import { ECOMMERCE_ADAPTER } from '../interfaces/ecommerce-adapter.interface';

describe('ProductSyncService', () => {
  let service: ProductSyncService;

  const mockPrisma = {
    product: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockProductRetriever = {
    generateAndStoreEmbedding: jest.fn().mockResolvedValue(undefined),
  };

  const mockEcommerceAdapter = {
    initialize: jest.fn().mockResolvedValue(undefined),
    getProducts: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProductRetrieverService, useValue: mockProductRetriever },
        { provide: ECOMMERCE_ADAPTER, useValue: mockEcommerceAdapter },
      ],
    }).compile();

    service = module.get<ProductSyncService>(ProductSyncService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('syncProducts', () => {
    it('should create new products when none exist locally', async () => {
      const externalProducts = [
        {
          externalId: 'woo-1',
          name: 'Rice 5kg',
          description: 'Premium rice',
          price: 500,
          stockQuantity: 100,
          isActive: true,
          attributes: {},
        },
      ];

      mockEcommerceAdapter.getProducts.mockResolvedValue(externalProducts);
      mockPrisma.product.findFirst.mockResolvedValue(null); // no existing product
      mockPrisma.product.create.mockResolvedValue({});

      const result = await service.syncProducts('tenant-1');

      expect(result.success).toBe(true);
      expect(result.newCount).toBe(1);
      expect(result.updateCount).toBe(0);
      expect(result.totalProcessed).toBe(1);
      expect(mockEcommerceAdapter.initialize).toHaveBeenCalledWith('tenant-1');
      expect(mockPrisma.product.create).toHaveBeenCalledTimes(1);
    });

    it('should update existing products', async () => {
      const externalProducts = [
        {
          externalId: 'woo-1',
          name: 'Rice 5kg Updated',
          description: 'Premium rice v2',
          price: 550,
          stockQuantity: 80,
          isActive: true,
          attributes: {},
        },
      ];

      mockEcommerceAdapter.getProducts.mockResolvedValue(externalProducts);
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'existing-prod-1',
        woocommerceId: 'woo-1',
      });
      mockPrisma.product.update.mockResolvedValue({});

      const result = await service.syncProducts('tenant-1');

      expect(result.success).toBe(true);
      expect(result.newCount).toBe(0);
      expect(result.updateCount).toBe(1);
      expect(mockPrisma.product.update).toHaveBeenCalledTimes(1);
    });

    it('should handle empty product list from adapter', async () => {
      mockEcommerceAdapter.getProducts.mockResolvedValue([]);

      const result = await service.syncProducts('tenant-1');

      expect(result.success).toBe(true);
      expect(result.newCount).toBe(0);
      expect(result.updateCount).toBe(0);
      expect(result.totalProcessed).toBe(0);
    });

    it('should trigger embedding generation for synced products', async () => {
      mockEcommerceAdapter.getProducts.mockResolvedValue([
        {
          externalId: 'woo-1',
          name: 'Product A',
          description: 'Desc',
          price: 100,
          stockQuantity: 10,
          isActive: true,
          attributes: {},
        },
      ]);

      mockPrisma.product.findFirst.mockResolvedValue(null);
      mockPrisma.product.create.mockResolvedValue({});

      await service.syncProducts('tenant-1');

      // Embedding generation is called asynchronously
      // We just verify the function is invoked
      expect(mockProductRetriever.generateAndStoreEmbedding).toHaveBeenCalled();
    });
  });
});
