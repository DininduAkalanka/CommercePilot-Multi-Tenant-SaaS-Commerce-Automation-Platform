import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { IntentDetectorService } from './pipeline/intent-detector.service';
import { ProductRetrieverService } from './pipeline/product-retriever.service';
import { EntityExtractorService } from './pipeline/entity-extractor.service';
import { ConfidenceScorerService } from './pipeline/confidence-scorer.service';
import { AIDraftStatus, AIProcessingStage } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ProcessMessageInput {
  tenantId: string;
  customerId: string;
  messageId: string;
  messageText: string;
  /** Previous messages in this conversation — for multi-turn extraction */
  conversationHistory?: string[];
  // Tenant config
  autoApproveEnabled: boolean;
  autoApproveThreshold: number;
  aiConfidenceThreshold: number;
}

export interface ProcessMessageOutput {
  intent: string;
  draftOrderId: string | null;
  routing: string;
  overallConfidence: number;
  missingFields: string[];
  followUpQuestion: string | null;
  extractedOrder?: any;
}

/**
 * AiEngineService
 *
 * The brain of CommercePilot. Orchestrates the full AI processing pipeline:
 *
 * 1. IntentDetector    — What does the customer want?
 * 2. ProductRetriever  — What products are relevant? (RAG)
 * 3. EntityExtractor   — What exactly did they order? (structured JSON)
 * 4. ConfidenceScorer  — How confident is the AI? What routing?
 * 5. DraftOrderBuilder — Build the AIDraftOrder record
 *
 * This service is called by the WhatsApp webhook job processor.
 * It never blocks the webhook — all processing is async via BullMQ.
 */
@Injectable()
export class AiEngineService {
  private readonly logger = new Logger(AiEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiAdapter,
    private readonly intentDetector: IntentDetectorService,
    private readonly productRetriever: ProductRetrieverService,
    private readonly entityExtractor: EntityExtractorService,
    private readonly confidenceScorer: ConfidenceScorerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Process a WhatsApp message through the full AI pipeline.
   * Returns routing decision and draft order ID if applicable.
   */
  async processMessage(input: ProcessMessageInput): Promise<ProcessMessageOutput> {
    const pipelineStart = Date.now();

    this.logger.log(
      `[${input.tenantId}] AI pipeline starting for message: ${input.messageId}`,
    );

    // ── Stage 1: Intent Detection ────────────────────────────────
    const intentResult = await this.intentDetector.detect(
      input.tenantId,
      input.messageId,
      input.messageText,
    );

    // Only continue with ORDER intent
    if (intentResult.intent !== 'ORDER') {
      this.logger.log(
        `[${input.tenantId}] Non-order intent (${intentResult.intent}) — skipping order pipeline`,
      );
      return {
        intent: intentResult.intent,
        draftOrderId: null,
        routing: 'NON_ORDER',
        overallConfidence: intentResult.confidence,
        missingFields: [],
        followUpQuestion: null,
      };
    }

    // ── Stage 2: Product Retrieval (RAG) ─────────────────────────
    const { products, catalogContext } = await this.productRetriever.retrieve(
      input.tenantId,
      input.messageId,
      input.messageText,
    );

    if (products.length === 0) {
      this.logger.warn(`[${input.tenantId}] No products found in catalog for RAG`);
    }

    // ── Stage 3: Entity Extraction ───────────────────────────────
    // Pass conversation history for multi-turn context merging
    const extractedOrder = await this.entityExtractor.extract(
      input.tenantId,
      input.messageId,
      input.messageText,
      catalogContext,
      input.conversationHistory ?? [],
    );

    // ── Stage 4: Confidence Scoring ──────────────────────────────
    const confidenceScores = await this.confidenceScorer.score(
      input.tenantId,
      input.customerId,
      input.messageId,
      intentResult.confidence,
      extractedOrder,
      input.autoApproveEnabled,
      input.autoApproveThreshold,
    );

    // ── Stage 5: Draft Order Creation ─────────────────────────────
    let draftOrderId: string | null = null;
    let followUpQuestion: string | null = null;

    if (confidenceScores.routing === 'gather_more_info') {
      // Generate a follow-up question asking for missing info
      followUpQuestion = await this.generateFollowUpQuestion(
        extractedOrder.missing_fields,
        extractedOrder.items[0]?.matched_product_name ?? 'the items',
      );
    } else {
      // Create the draft order for owner review
      draftOrderId = await this.createDraftOrder(input, extractedOrder, confidenceScores);
    }

    // Update message as AI-processed
    await this.prisma.whatsAppMessage.update({
      where: { id: input.messageId },
      data: {
        aiProcessed: true,
        aiProcessedAt: new Date(),
      },
    });

    // ── Stage 6: Auto-Approval Flow (Phase 2) ─────────────────────
    if (draftOrderId && confidenceScores.routing === 'auto_approve') {
      this.logger.log(`[${input.tenantId}] Draft ${draftOrderId} is eligible for auto-approval. Emitting event.`);
      this.eventEmitter.emit('draft.auto_approve', {
        tenantId: input.tenantId,
        draftId: draftOrderId,
      });
    }

    const totalTimeMs = Date.now() - pipelineStart;
    this.logger.log(
      `[${input.tenantId}] AI pipeline complete in ${totalTimeMs}ms → ${confidenceScores.routing}`,
    );

    return {
      intent: intentResult.intent,
      draftOrderId,
      routing: confidenceScores.routing,
      overallConfidence: confidenceScores.composite,
      missingFields: extractedOrder.missing_fields,
      followUpQuestion,
      extractedOrder,
    };
  }

  // ── Private helpers ────────────────────────────────────────────

  private async createDraftOrder(
    input: ProcessMessageInput,
    extractedOrder: ReturnType<typeof this.entityExtractor.extract> extends Promise<infer T> ? T : never,
    scores: Awaited<ReturnType<typeof this.confidenceScorer.score>>,
  ): Promise<string> {
    const draftId = uuidv4();

    await this.prisma.aIDraftOrder.create({
      data: {
        id: draftId,
        tenantId: input.tenantId,
        customerId: input.customerId,
        messageId: input.messageId,
        customerMessage: input.messageText,
        structuredData: extractedOrder as object,
        intentConfidence: scores.intent,
        productMatchConfidence: scores.productMatch,
        completenessScore: scores.completeness,
        overallConfidence: scores.composite,
        status: AIDraftStatus.PENDING,
        items: {
          create: extractedOrder.items.map((item) => ({
            id: uuidv4(),
            tenantId: input.tenantId,
            productQuery: item.product_query,
            productId: item.matched_product_id,
            matchedProductName: item.matched_product_name,
            matchConfidence: item.match_confidence,
            quantity: item.quantity ?? 1,
            selectedAttributes: item.selected_attributes as object,
          })),
        },
      },
    });

    this.logger.log(`[${input.tenantId}] Draft order created: ${draftId}`);
    this.eventEmitter.emit('draft.created', { tenantId: input.tenantId, draftId });
    return draftId;
  }

  /**
   * Public method to create a draft order directly from accumulated conversation context.
   */
  async createDraftFromContext(
    tenantId: string,
    customerId: string,
    messageId: string,
    messageText: string,
    contextData: any,
    composite: number,
  ): Promise<string> {
    const draftId = uuidv4();

    // Map contextData to the structure expected by the DB
    const extractedOrder = {
      items: contextData.pendingItems || [],
      delivery_info: contextData.deliveryInfo || {},
      missing_fields: [],
      customer_notes: contextData.customer_notes || null,
    };

    await this.prisma.aIDraftOrder.create({
      data: {
        id: draftId,
        tenantId,
        customerId,
        messageId,
        customerMessage: messageText,
        structuredData: extractedOrder as object,
        intentConfidence: 1.0,
        productMatchConfidence: 1.0,
        completenessScore: 1.0,
        overallConfidence: composite,
        status: AIDraftStatus.PENDING,
        items: {
          create: extractedOrder.items.map((item: any) => ({
            id: uuidv4(),
            tenantId,
            productQuery: item.product_query,
            productId: item.matched_product_id,
            matchedProductName: item.matched_product_name,
            matchConfidence: item.match_confidence ?? 1.0,
            quantity: item.quantity ?? 1,
            selectedAttributes: (item.selected_attributes ?? {}) as object,
          })),
        },
      },
    });

    this.logger.log(`[${tenantId}] Confirmed context draft order created: ${draftId}`);
    this.eventEmitter.emit('draft.created', { tenantId, draftId });

    // Log draft order creation stage
    await this.prisma.aIProcessingLog.create({
      data: {
        tenantId: tenantId,
        messageId: messageId,
        stage: AIProcessingStage.DRAFT_ORDER_GENERATION,
        inputData: { extractedOrder: extractedOrder as object },
        outputData: { draftOrderId: draftId, itemCount: extractedOrder.items.length },
        modelUsed: 'system',
        promptVersion: '1.0.0',
        processingTimeMs: 0,
        overallConfidence: composite,
        success: true,
      },
    });

    return draftId;
  }

  private async generateFollowUpQuestion(
    missingFields: string[],
    productName: string,
  ): Promise<string> {
    // Simple template-based questions (no LLM needed — saves tokens)
    const fieldQuestions: Record<string, string> = {
      quantity: `How many would you like?`,
      size: `What size do you need? (S/M/L/XL)`,
      color: `What color would you prefer?`,
      delivery_address: `Could you please share your delivery address?`,
    };

    const questions = missingFields
      .map((f) => fieldQuestions[f])
      .filter(Boolean)
      .join(' ');

    return `Thanks for your message! 😊 To process your order for ${productName}, I need a bit more info: ${questions}`;
  }
}
