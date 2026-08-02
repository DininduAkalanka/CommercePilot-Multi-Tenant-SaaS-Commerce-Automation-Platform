import { Test, TestingModule } from '@nestjs/testing';
import { ProductRetrieverService } from './product-retriever.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { GeminiAdapter } from '../adapters/gemini.adapter';

describe('ProductRetrieverService', () => {
  let service: ProductRetrieverService;

  const mockPrisma = {
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    aIProcessingLog: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const mockGemini = {
    generateEmbedding: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductRetrieverService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GeminiAdapter, useValue: mockGemini },
      ],
    }).compile();

    service = module.get<ProductRetrieverService>(ProductRetrieverService);
    mockPrisma.aIProcessingLog.create.mockResolvedValue({});
  });

  afterEach(() => jest.clearAllMocks());

  describe('embedding unavailable', () => {
    // Regression: generateEmbedding used to return `Math.random() - 0.5`
    // vectors when no key was set OR on any API error, so a single transient
    // failure permanently wrote 768 dimensions of noise into the column.
    it('skips vector search and falls back to text search when no embedding', async () => {
      mockGemini.generateEmbedding.mockResolvedValue(null);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.retrieve('tenant-1', 'msg-1', 'I want a mouse');

      // No vector query attempted at all.
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrisma.product.findMany).toHaveBeenCalled();
    });

    it('leaves embedding NULL rather than storing a placeholder', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'Wireless Mouse',
        description: null,
        sku: 'WM-1',
        attributes: {},
      });
      mockGemini.generateEmbedding.mockResolvedValue(null);

      await service.generateAndStoreEmbedding('p1', 'tenant-1');

      // The UPDATE must not run — a NULL column degrades to text search,
      // whereas a junk vector silently poisons retrieval forever.
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('stores the embedding when one is produced', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'Wireless Mouse',
        description: null,
        sku: 'WM-1',
        attributes: {},
      });
      mockGemini.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1));
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.generateAndStoreEmbedding('p1', 'tenant-1');

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('text search fallback', () => {
    // Regression: the entire message was passed to `contains`, so
    // "I want to buy a mouse" was matched literally against product names and
    // never hit "Wireless Mouse" — the fallback returned nothing exactly when
    // it was needed.
    it('matches on individual meaningful terms, not the whole sentence', async () => {
      mockGemini.generateEmbedding.mockResolvedValue(null);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.retrieve('tenant-1', 'msg-1', 'I want to buy a mouse');

      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      const searched = where.OR.map(
        (clause: Record<string, { contains: string }>) =>
          Object.values(clause)[0].contains,
      );

      expect(searched).toContain('mouse');
      // Stop words and short tokens must not become search terms.
      expect(searched).not.toContain('want');
      expect(searched).not.toContain('buy');
      expect(searched).not.toContain('to');
    });

    it('returns nothing when the message has no meaningful terms', async () => {
      mockGemini.generateEmbedding.mockResolvedValue(null);

      const result = await service.retrieve('tenant-1', 'msg-1', 'hi there');

      // "hi" is a stop word, "there" is not a product signal we index on —
      // querying with no terms would otherwise return the whole catalog.
      expect(result.products).toEqual([]);
    });
  });
});
