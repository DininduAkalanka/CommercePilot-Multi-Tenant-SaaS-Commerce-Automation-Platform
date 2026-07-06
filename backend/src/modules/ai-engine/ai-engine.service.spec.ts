import { Test, TestingModule } from '@nestjs/testing';
import { AiEngineService } from './ai-engine.service';
import { PrismaService } from '../../common/database/prisma.service';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { IntentDetectorService } from './pipeline/intent-detector.service';
import { ProductRetrieverService } from './pipeline/product-retriever.service';
import { EntityExtractorService } from './pipeline/entity-extractor.service';
import { ConfidenceScorerService } from './pipeline/confidence-scorer.service';
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
        products: [{ id: 'prod-1', name: 'Rice', price: 500, stockQuantity: 10 }],
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
        composite: 0.90,
        intent: 0.92,
        productMatch: 0.88,
        completeness: 0.90,
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
    });

    it('should emit draft.auto_approve when routing is auto_approve', async () => {
      mockIntentDetector.detect.mockResolvedValue({
        intent: 'ORDER',
        confidence: 0.98,
      });

      mockProductRetriever.retrieve.mockResolvedValue({
        products: [{ id: 'prod-1', name: 'Rice', price: 500, stockQuantity: 10 }],
        catalogContext: 'Rice details',
      });

      mockEntityExtractor.extract.mockResolvedValue({
        items: [{
          product_query: 'rice',
          matched_product_id: 'prod-1',
          matched_product_name: 'Rice',
          match_confidence: 0.97,
          quantity: 2,
          selected_attributes: {},
        }],
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
