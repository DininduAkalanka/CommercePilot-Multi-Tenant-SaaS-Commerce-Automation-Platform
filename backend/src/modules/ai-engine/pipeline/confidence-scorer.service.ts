import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { AIProcessingStage } from '@prisma/client';
import { ExtractedOrder } from './entity-extractor.service';

export type ConfidenceRouting =
  | 'auto_approve'
  | 'human_review'
  | 'gather_more_info';

export interface ConfidenceScores {
  intent: number;
  productMatch: number;
  completeness: number;
  historicalCustomer: number;
  composite: number;
  routing: ConfidenceRouting;
  explanation: string[];
}

/**
 * ConfidenceScorerService
 *
 * Stage 4 of the AI pipeline.
 * Calculates composite confidence scores from the previous pipeline stages.
 * Determines routing: auto_approve, human_review, or gather_more_info.
 */
@Injectable()
export class ConfidenceScorerService {
  private readonly logger = new Logger(ConfidenceScorerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async score(
    tenantId: string,
    customerId: string,
    messageId: string,
    intentConfidence: number,
    extractedOrder: ExtractedOrder,
    autoApproveEnabled: boolean,
    autoApproveThreshold: number,
  ): Promise<ConfidenceScores> {
    const startTime = Date.now();

    // 1. intent score
    const intent = intentConfidence;

    // 2. productMatch (average of match_confidence across items)
    const productMatch =
      extractedOrder.items.length > 0
        ? extractedOrder.items.reduce(
            (sum, item) => sum + (item.match_confidence ?? 0),
            0,
          ) / extractedOrder.items.length
        : 0;

    // 3. completeness (1.0 = no missing, 0.5 = 1 missing, 0.0 = 2+ missing)
    let completeness = 1.0;
    if (extractedOrder.missing_fields.length === 1) {
      completeness = 0.5;
    } else if (extractedOrder.missing_fields.length >= 2) {
      completeness = 0.0;
    }

    // 4. historicalCustomer (0.1 bonus if customer has prior orders)
    const priorOrdersCount = await this.prisma.order.count({
      where: { tenantId, customerId },
    });
    const historicalCustomer = priorOrdersCount > 0 ? 0.1 : 0.0;

    // 5. composite (weighted: intent*0.25 + match*0.40 + completeness*0.25 + history*0.10)
    let composite =
      intent * 0.25 +
      productMatch * 0.4 +
      completeness * 0.25 +
      historicalCustomer;

    // Cap composite confidence at 1.0
    composite = Math.min(1.0, composite);

    // 6. routing routing values: auto_approve | human_review | gather_more_info
    let routing: ConfidenceRouting = 'gather_more_info';
    if (extractedOrder.missing_fields.length > 0 || composite < 0.6) {
      routing = 'gather_more_info';
    } else if (autoApproveEnabled && composite >= autoApproveThreshold) {
      routing = 'auto_approve';
    } else if (composite >= 0.6) {
      routing = 'human_review';
    }

    const explanation = [
      `Composite score: ${(composite * 100).toFixed(1)}%`,
      `• Intent recognition: ${(intent * 100).toFixed(1)}%`,
      `• Product match: ${(productMatch * 100).toFixed(1)}%`,
      `• Order completeness: ${(completeness * 100).toFixed(1)}%`,
      `• Repeat customer bonus: ${historicalCustomer > 0 ? '+10%' : 'None'}`,
    ];

    const scores: ConfidenceScores = {
      intent,
      productMatch,
      completeness,
      historicalCustomer,
      composite,
      routing,
      explanation,
    };

    const processingTimeMs = Date.now() - startTime;

    // Log this stage
    await this.prisma.aIProcessingLog.create({
      data: {
        tenantId,
        messageId,
        stage: AIProcessingStage.CONFIDENCE_SCORING,
        inputData: {
          intentConfidence,
          productMatch,
          completeness,
          missingFields: extractedOrder.missing_fields,
          autoApproveEnabled,
          autoApproveThreshold,
        },
        outputData: scores as any,
        modelUsed: 'rule-based-scorer-v2',
        promptVersion: '2.0.0',
        processingTimeMs,
        intentConfidence: intent,
        productMatchConfidence: productMatch,
        completenessScore: completeness,
        overallConfidence: composite,
        success: true,
      },
    });

    this.logger.log(
      `[${tenantId}] Confidence: ${(composite * 100).toFixed(1)}% → ${routing}`,
    );

    return scores;
  }
}
