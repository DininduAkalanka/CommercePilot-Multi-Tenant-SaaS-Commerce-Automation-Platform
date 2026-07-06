import { Injectable, Logger } from '@nestjs/common';
import { GeminiAdapter } from '../adapters/gemini.adapter';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  ENTITY_EXTRACTION_USER_PROMPT,
  MULTI_TURN_ENTITY_EXTRACTION_SYSTEM_PROMPT,
  MULTI_TURN_ENTITY_EXTRACTION_USER_PROMPT,
  PROMPT_VERSION,
  PROMPT_VERSION_V2,
} from '../prompts/system.prompts';
import { AIProcessingStage } from '@prisma/client';

export interface ExtractedItem {
  product_query: string;
  matched_product_id: string | null;
  matched_product_name: string | null;
  match_confidence: number;
  quantity: number | null;
  selected_attributes: {
    size: string | null;
    color: string | null;
    [key: string]: string | null;
  };
}

export interface ExtractedOrder {
  items: ExtractedItem[];
  delivery_info: {
    address: string | null;
    requested_date: string | null;
    notes: string | null;
  };
  missing_fields: string[];
  customer_notes: string | null;
}

/**
 * EntityExtractorService
 *
 * Stage 3 of the AI pipeline.
 * Uses the RAG catalog context (from Stage 2) to extract a structured
 * order from the customer's message.
 *
 * CRITICAL: The AI is strictly forbidden from inventing products.
 * It can only reference products from the catalog context provided.
 */
@Injectable()
export class EntityExtractorService {
  private readonly logger = new Logger(EntityExtractorService.name);

  constructor(
    private readonly gemini: GeminiAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async extract(
    tenantId: string,
    messageId: string,
    messageText: string,
    catalogContext: string, // formatted product list from ProductRetrieverService
    conversationHistory?: string[], // optional: previous messages in this conversation
  ): Promise<ExtractedOrder> {
    const startTime = Date.now();
    const isMultiTurn = conversationHistory && conversationHistory.length > 0;

    this.logger.log(
      `[${tenantId}] Extracting entities from: ${messageText.substring(0, 50)}... (${isMultiTurn ? 'multi-turn' : 'single-turn'})`,
    );

    // Use multi-turn prompt when conversation history is available
    const systemPrompt = isMultiTurn
      ? MULTI_TURN_ENTITY_EXTRACTION_SYSTEM_PROMPT
      : ENTITY_EXTRACTION_SYSTEM_PROMPT;

    const userPrompt = isMultiTurn
      ? MULTI_TURN_ENTITY_EXTRACTION_USER_PROMPT(conversationHistory, messageText, catalogContext)
      : ENTITY_EXTRACTION_USER_PROMPT(messageText, catalogContext);

    const promptVersion = isMultiTurn ? PROMPT_VERSION_V2 : PROMPT_VERSION;

    const response = await this.gemini.generateText(systemPrompt, userPrompt, {
      temperature: 0.05,
      maxOutputTokens: 1024,
    });

    const processingTimeMs = Date.now() - startTime;

    let result: ExtractedOrder;

    if (response.success && response.text) {
      try {
        result = this.gemini.parseJsonResponse<ExtractedOrder>(response.text);
      } catch {
        this.logger.warn('Failed to parse entity extraction JSON');
        result = this.emptyExtraction();
      }
    } else {
      result = this.emptyExtraction();
    }

    // Calculate average product match confidence
    const avgMatchConfidence =
      result.items.length > 0
        ? result.items.reduce((sum, item) => sum + item.match_confidence, 0) /
          result.items.length
        : 0;

    // Log this AI processing stage
    await this.prisma.aIProcessingLog.create({
      data: {
        tenantId,
        messageId,
        stage: AIProcessingStage.ENTITY_EXTRACTION,
        inputData: { message: messageText, catalogContext, conversationHistory, systemPrompt, userPrompt },
        outputData: result as object,
        modelUsed: response.modelUsed,
        promptVersion,
        processingTimeMs,
        tokenCount: response.tokenCount,
        productMatchConfidence: avgMatchConfidence,
        success: response.success,
        errorMessage: response.error,
      },
    });

    this.logger.log(
      `[${tenantId}] Extracted ${result.items.length} items, ${result.missing_fields.length} missing fields`,
    );

    return result;
  }

  private emptyExtraction(): ExtractedOrder {
    return {
      items: [],
      delivery_info: { address: null, requested_date: null, notes: null },
      missing_fields: ['product', 'quantity'],
      customer_notes: null,
    };
  }
}
