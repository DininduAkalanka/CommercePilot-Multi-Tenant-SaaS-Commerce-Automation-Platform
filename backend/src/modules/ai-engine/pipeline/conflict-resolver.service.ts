import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { GeminiAdapter } from '../adapters/gemini.adapter';
import {
  STOCK_CONFLICT_RESOLUTION_PROMPT,
  PROMPT_VERSION_V2,
} from '../prompts/system.prompts';
import { AIProcessingStage } from '@prisma/client';

export interface StockConflict {
  productId: string;
  productName: string;
  requested: number;
  available: number;
}

export interface StockConflictResult {
  hasConflicts: boolean;
  conflicts: StockConflict[];
  /** AI-generated customer-friendly message about the conflict */
  suggestedMessage: string | null;
}

/**
 * ConflictResolverService
 *
 * Phase 2 — Stage for handling stock conflicts during order approval.
 *
 * When a draft order cannot be fully fulfilled due to insufficient stock,
 * this service:
 * 1. Identifies which items have insufficient stock
 * 2. Uses Gemini to generate a friendly customer-facing message
 * 3. Logs the resolution attempt to AIProcessingLog (rule: all AI calls logged)
 *
 * Uses AIProcessingStage.CONFLICT_RESOLUTION (already in the schema enum).
 */
@Injectable()
export class ConflictResolverService {
  private readonly logger = new Logger(ConflictResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiAdapter,
  ) {}

  /**
   * Check a draft order's items against current stock levels.
   * Returns conflict details and an AI-generated resolution message.
   */
  async resolveStockConflicts(
    tenantId: string,
    messageId: string | null,
    draftItems: Array<{
      productId: string | null;
      matchedProductName: string | null;
      quantity: number;
    }>,
  ): Promise<StockConflictResult> {
    const startTime = Date.now();

    // Filter to items that have a matched product
    const itemsWithProducts = draftItems.filter((item) => item.productId !== null);

    if (itemsWithProducts.length === 0) {
      return { hasConflicts: false, conflicts: [], suggestedMessage: null };
    }

    // Batch-fetch current stock for all matched products (tenant-scoped)
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: itemsWithProducts.map((i) => i.productId as string) },
        tenantId,
        deletedAt: null,
      },
      select: { id: true, name: true, stockQuantity: true },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Find conflicts: requested > available
    const conflicts: StockConflict[] = [];
    for (const item of itemsWithProducts) {
      const product = productMap.get(item.productId as string);
      if (!product) continue;

      if (item.quantity > product.stockQuantity) {
        conflicts.push({
          productId: product.id,
          productName: product.name,
          requested: item.quantity,
          available: product.stockQuantity,
        });
      }
    }

    if (conflicts.length === 0) {
      return { hasConflicts: false, conflicts: [], suggestedMessage: null };
    }

    this.logger.warn(
      `[${tenantId}] Stock conflicts detected for ${conflicts.length} item(s)`,
    );

    // Generate customer-friendly resolution message via Gemini
    const prompt = STOCK_CONFLICT_RESOLUTION_PROMPT(conflicts);
    const response = await this.gemini.generateText(
      'You are a helpful customer service assistant.',
      prompt,
      { temperature: 0.3, maxOutputTokens: 256 },
    );

    const suggestedMessage = response.success && response.text
      ? response.text.trim()
      : `Sorry, some items in your order are out of stock. Our team will contact you shortly to resolve this. 🙏`;

    const processingTimeMs = Date.now() - startTime;

    // Log to AIProcessingLog (architecture rule: all AI calls must be logged)
    await this.prisma.aIProcessingLog.create({
      data: {
        tenantId,
        messageId,
        stage: AIProcessingStage.CONFLICT_RESOLUTION,
        inputData: { conflicts } as object,
        outputData: { suggestedMessage },
        modelUsed: response.modelUsed ?? 'gemini-1.5-flash',
        promptVersion: PROMPT_VERSION_V2,
        processingTimeMs,
        tokenCount: response.tokenCount,
        success: response.success,
        errorMessage: response.error,
      },
    });

    return {
      hasConflicts: true,
      conflicts,
      suggestedMessage,
    };
  }
}
