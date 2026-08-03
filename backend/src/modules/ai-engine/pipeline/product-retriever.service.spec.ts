import { Test, TestingModule } from '@nestjs/testing';
import { ProductRetrieverService } from './product-retriever.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { AI_ADAPTER } from '../adapters/ai-adapter.interface';

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

  const mockAi = {
    generateEmbedding: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductRetrieverService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AI_ADAPTER, useValue: mockAi },
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
      mockAi.generateEmbedding.mockResolvedValue(null);
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
      mockAi.generateEmbedding.mockResolvedValue(null);

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
      mockAi.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1));
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.generateAndStoreEmbedding('p1', 'tenant-1');

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('referral hint', () => {
    /**
     * A customer arriving from a Click-to-WhatsApp ad often says only
     * "mata meka one" ("I want this") — obvious to them because they are
     * looking at the product, but unmatchable on its own. The ad's headline
     * names it exactly, so retrieval must search on both.
     */
    it('searches on the ad copy as well as the customer message', async () => {
      mockAi.generateEmbedding.mockResolvedValue(null);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.retrieve(
        'tenant-1',
        'msg-1',
        'mata meka one',
        'Blue Cotton Shirt New Arrival',
      );

      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      const searched = where.OR.map(
        (clause: Record<string, { contains: string }>) =>
          Object.values(clause)[0].contains,
      );

      // Terms from the ad copy make the product findable...
      expect(searched).toContain('blue');
      expect(searched).toContain('cotton');
      expect(searched).toContain('shirt');
      // ...and the customer's own words are still included, since they may
      // carry a size or colour the ad did not mention.
      expect(searched).toContain('meka');
    });

    it('behaves exactly as before when there is no referral', async () => {
      mockAi.generateEmbedding.mockResolvedValue(null);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.retrieve('tenant-1', 'msg-1', 'I want a mouse');

      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      const searched = where.OR.map(
        (clause: Record<string, { contains: string }>) =>
          Object.values(clause)[0].contains,
      );

      expect(searched).toContain('mouse');
      expect(searched).not.toContain('undefined');
      expect(searched).not.toContain('null');
    });

    it('embeds the combined text for vector search', async () => {
      mockAi.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1));
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.retrieve('tenant-1', 'msg-1', 'meka one', 'Cotton Saree');

      // The query vector must represent the ad copy too, or semantic search is
      // still working from an empty message.
      expect(mockAi.generateEmbedding).toHaveBeenCalledWith(
        expect.stringContaining('Cotton Saree'),
      );
    });
  });

  describe('raw SQL identifiers', () => {
    /**
     * Regression: the raw vector query used snake_case (`tenant_id`,
     * `is_active`, `deleted_at`, `stock_quantity`) but the Prisma schema maps
     * only the TABLE name — columns keep their model field names, so Postgres
     * created them as "tenantId", "isActive", "deletedAt", "stockQuantity".
     *
     * Every call therefore threw `column "tenant_id" does not exist`,
     * retrieve() caught it, and vector search silently degraded to text search
     * on 100% of messages. Nothing surfaced but a warning log.
     *
     * Unit tests mock Prisma and so cannot execute SQL; asserting on the query
     * text is the cheapest guard that would have caught this.
     */
    const sqlFrom = (mockCall: unknown[]): string =>
      (mockCall[0] as string[]).join('?');

    it('queries vector search with quoted camelCase columns', async () => {
      mockAi.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1));
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.retrieve('tenant-1', 'msg-1', 'wireless mouse');

      const sql = sqlFrom(mockPrisma.$queryRaw.mock.calls[0]);

      expect(sql).toContain('"tenantId"');
      expect(sql).toContain('"isActive"');
      expect(sql).toContain('"deletedAt"');
      expect(sql).toContain('"stockQuantity"');

      expect(sql).not.toContain('tenant_id');
      expect(sql).not.toContain('is_active');
      expect(sql).not.toContain('deleted_at');
      expect(sql).not.toContain('stock_quantity');
    });

    it('updates the embedding with a quoted camelCase tenant filter', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'Wireless Mouse',
        description: null,
        sku: 'WM-1',
        attributes: {},
      });
      mockAi.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1));
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.generateAndStoreEmbedding('p1', 'tenant-1');

      const sql = sqlFrom(mockPrisma.$executeRaw.mock.calls[0]);

      expect(sql).toContain('"tenantId"');
      expect(sql).not.toContain('tenant_id');
    });
  });

  describe('text search fallback', () => {
    // Regression: the entire message was passed to `contains`, so
    // "I want to buy a mouse" was matched literally against product names and
    // never hit "Wireless Mouse" — the fallback returned nothing exactly when
    // it was needed.
    it('matches on individual meaningful terms, not the whole sentence', async () => {
      mockAi.generateEmbedding.mockResolvedValue(null);
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
      mockAi.generateEmbedding.mockResolvedValue(null);

      const result = await service.retrieve('tenant-1', 'msg-1', 'hi there');

      // "hi" is a stop word, "there" is not a product signal we index on —
      // querying with no terms would otherwise return the whole catalog.
      expect(result.products).toEqual([]);
    });
  });
});
