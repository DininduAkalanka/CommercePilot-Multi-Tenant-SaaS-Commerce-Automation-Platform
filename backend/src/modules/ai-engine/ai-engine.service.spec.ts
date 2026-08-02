import { Test, TestingModule } from '@nestjs/testing';
import { AiEngineService } from './ai-engine.service';
import { PrismaService } from '../../common/database/prisma.service';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { IntentDetectorService } from './pipeline/intent-detector.service';
import { ProductRetrieverService } from './pipeline/product-retriever.service';
import { EntityExtractorService } from './pipeline/entity-extractor.service';
import { ConfidenceScorerService } from './pipeline/confidence-scorer.service';
import { UnfulfilledDemandService } from './unfulfilled-demand.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('AiEngineService', () => {
  let service: AiEngineService;

  const mockPrisma = {
    aIDraftOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    aIDraftOrderItem: {
      create: jest.fn(),
    },
    aIProcessingLog: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockGemini = {
    generateContent: jest.fn(),
    generateEmbedding: jest.fn(),
  };

  const mockIntentDetector = {
    detect: jest.fn(),
  };

  const mockProductRetriever = {
    retrieve: jest.fn(),
  };

  const mockEntityExtractor = {
    extract: jest.fn(),
  };

  const mockConfidenceScorer = {
    score: jest.fn(),
  };

  const mockUnfulfilledDemand = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GeminiAdapter, useValue: mockGemini },
        { provide: IntentDetectorService, useValue: mockIntentDetector },
        { provide: ProductRetrieverService, useValue: mockProductRetriever },
        { provide: EntityExtractorService, useValue: mockEntityExtractor },
        { provide: ConfidenceScorerService, useValue: mockConfidenceScorer },
        { provide: UnfulfilledDemandService, useValue: mockUnfulfilledDemand },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<AiEngineService>(AiEngineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMessage', () => {
    it('should return non-order routing when intent is not ORDER_PLACEMENT', async () => {
      mockIntentDetector.detect.mockResolvedValue({
        intent: 'GENERAL_INQUIRY',
        confidence: 0.95,
      });

      const result = await service.processMessage({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        messageId: 'msg-1',
        messageText: 'What are your store hours?',
        autoApproveEnabled: false,
        autoApproveThreshold: 0.95,
        aiConfidenceThreshold: 0.85,
      });

      expect(result.intent).toBe('GENERAL_INQUIRY');
      expect(result.routing).toBe('NON_ORDER');
      expect(result.draftOrderId).toBeNull();
      // Should NOT call product retriever for non-order intents
      expect(mockProductRetriever.retrieve).not.toHaveBeenCalled();
    });

    it('should run the full pipeline for ORDER intent', async () => {
      mockIntentDetector.detect.mockResolvedValue({
        intent: 'ORDER',
        confidence: 0.92,
      });

      mockProductRetriever.retrieve.mockResolvedValue({
        products: [
          { id: 'prod-1', name: 'Rice', price: 500, stockQuantity: 10 },
        ],
        catalogContext: '1. ID: prod-1\nName: Rice\nPrice: LKR 500',
      });

      mockEntityExtractor.extract.mockResolvedValue({
        items: [
          {
            product_query: 'rice',
            matched_product_id: 'prod-1',
            matched_product_name: 'Rice',
            match_confidence: 0.88,
            quantity: 2,
            selected_attributes: {},
          },
        ],
        delivery_info: {},
        missing_fields: [],
      });

      mockConfidenceScorer.score.mockResolvedValue({
        composite: 0.9,
        intent: 0.92,
        productMatch: 0.88,
        completeness: 0.9,
        routing: 'manual_review',
        missingFields: [],
      });

      mockPrisma.aIDraftOrder.create.mockResolvedValue({
        id: 'draft-1',
        tenantId: 'tenant-1',
      });

      // Mock the whatsAppMessage update call
      (mockPrisma as any).whatsAppMessage = {
        update: jest.fn().mockResolvedValue({}),
      };

      const result = await service.processMessage({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        messageId: 'msg-1',
        messageText: 'I want 2 bags of rice',
        autoApproveEnabled: false,
        autoApproveThreshold: 0.95,
        aiConfidenceThreshold: 0.85,
      });

      expect(result.intent).toBe('ORDER');
      expect(mockIntentDetector.detect).toHaveBeenCalledTimes(1);
      expect(mockProductRetriever.retrieve).toHaveBeenCalledTimes(1);
      expect(mockEntityExtractor.extract).toHaveBeenCalledTimes(1);
      expect(mockConfidenceScorer.score).toHaveBeenCalledTimes(1);
      // A successful match is not unfulfilled demand.
      expect(mockUnfulfilledDemand.record).not.toHaveBeenCalled();
    });

    describe('unfulfilled demand', () => {
      /**
       * `matched_product_id === null` means the AI understood the request but
       * found nothing in the catalog to satisfy it — the customer wanted to
       * buy something the business does not sell. That is a stocking signal,
       * and it used to be discarded along with the failed match.
       */
      const runWithUnmatchedItem = async (
        retrievedCount: number,
        tenantHasProducts = true,
      ) => {
        (mockPrisma as any).product = {
          findFirst: jest
            .fn()
            .mockResolvedValue(tenantHasProducts ? { id: 'p1' } : null),
        };
        mockIntentDetector.detect.mockResolvedValue({
          intent: 'ORDER',
          confidence: 0.9,
        });
        mockProductRetriever.retrieve.mockResolvedValue({
          products: Array.from({ length: retrievedCount }, (_, i) => ({
            id: `p${i}`,
            name: `Product ${i}`,
            price: 100,
            stockQuantity: 5,
          })),
          catalogContext: retrievedCount
            ? 'catalog'
            : 'No products found in catalog.',
        });
        mockEntityExtractor.extract.mockResolvedValue({
          items: [
            {
              product_query: 'red saree',
              matched_product_id: null,
              matched_product_name: null,
              match_confidence: 0,
              quantity: 1,
              selected_attributes: {},
            },
          ],
          delivery_info: {},
          missing_fields: ['product'],
        });
        mockConfidenceScorer.score.mockResolvedValue({
          composite: 0.3,
          intent: 0.9,
          productMatch: 0,
          completeness: 0,
          routing: 'gather_more_info',
          missingFields: ['product'],
        });
        (mockPrisma as any).whatsAppMessage = {
          update: jest.fn().mockResolvedValue({}),
        };

        await service.processMessage({
          tenantId: 'tenant-1',
          customerId: 'cust-1',
          messageId: 'msg-1',
          messageText: 'mata red saree ekak one',
          autoApproveEnabled: false,
          autoApproveThreshold: 0.95,
          aiConfidenceThreshold: 0.85,
        });
      };

      it('records what the customer asked for when nothing matched', async () => {
        await runWithUnmatchedItem(3);

        expect(mockUnfulfilledDemand.record).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: 'tenant-1',
            customerId: 'cust-1',
            messageId: 'msg-1',
            query: 'red saree',
            reason: 'NO_CATALOG_MATCH',
          }),
        );
      });

      it('reports a genuine stocking gap when retrieval finds nothing but the catalogue has products', async () => {
        // Retrieval returning nothing for "red saree" does NOT mean the tenant
        // has no products — a full catalogue simply may not carry sarees.
        // Conflating the two would tell an established shop it has not
        // onboarded yet.
        await runWithUnmatchedItem(0, true);

        expect(mockUnfulfilledDemand.record).toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'NO_CATALOG_MATCH' }),
        );
      });

      it('reports an empty catalogue only when the tenant truly has no products', async () => {
        // This one IS an onboarding problem ("you have not synced products"),
        // not a stocking one, and the owner needs to see the difference.
        await runWithUnmatchedItem(0, false);

        expect(mockUnfulfilledDemand.record).toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'EMPTY_CATALOG' }),
        );
      });

      it('does not pay for the catalogue lookup when retrieval found products', async () => {
        await runWithUnmatchedItem(3);

        expect((mockPrisma as any).product.findFirst).not.toHaveBeenCalled();
      });
    });

    it('should emit draft.auto_approve when routing is auto_approve', async () => {
      mockIntentDetector.detect.mockResolvedValue({
        intent: 'ORDER',
        confidence: 0.98,
      });

      mockProductRetriever.retrieve.mockResolvedValue({
        products: [
          { id: 'prod-1', name: 'Rice', price: 500, stockQuantity: 10 },
        ],
        catalogContext: 'Rice details',
      });

      mockEntityExtractor.extract.mockResolvedValue({
        items: [
          {
            product_query: 'rice',
            matched_product_id: 'prod-1',
            matched_product_name: 'Rice',
            match_confidence: 0.97,
            quantity: 2,
            selected_attributes: {},
          },
        ],
        delivery_info: {},
        missing_fields: [],
      });

      mockConfidenceScorer.score.mockResolvedValue({
        composite: 0.97,
        intent: 0.98,
        productMatch: 0.97,
        completeness: 0.96,
        routing: 'auto_approve',
        missingFields: [],
      });

      mockPrisma.aIDraftOrder.create.mockResolvedValue({
        id: 'draft-auto',
        tenantId: 'tenant-1',
      });

      // Mock the whatsAppMessage update call
      (mockPrisma as any).whatsAppMessage = {
        update: jest.fn().mockResolvedValue({}),
      };

      await service.processMessage({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        messageId: 'msg-1',
        messageText: '2 bags of rice',
        autoApproveEnabled: true,
        autoApproveThreshold: 0.95,
        aiConfidenceThreshold: 0.85,
      });

      // Should emit auto-approve event
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'draft.auto_approve',
        expect.objectContaining({
          tenantId: 'tenant-1',
        }),
      );
    });
  });
});
