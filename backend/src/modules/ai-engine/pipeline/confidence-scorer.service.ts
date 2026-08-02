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

  /**
   * Routing bands from BUSINESS_RULES.md §10 — the business-logic constitution,
   * which states it takes precedence over any conflicting implementation.
   *
   *   >= 0.95        automatic draft creation
   *   0.80 – 0.94    owner review recommended
   *   <  0.80        manual confirmation required before order creation
   *
   * Expressed as named constants rather than inline magic numbers so a change
   * here is visibly a change to a business rule, not a tweak to a heuristic.
   */
  static readonly AUTO_APPROVE_FLOOR = 0.95;
  static readonly HUMAN_REVIEW_FLOOR = 0.8;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A tenant may make auto-approval *stricter* than §10, never looser.
   *
   * `Tenant.autoApproveThreshold` defaults to 0.95, but nothing prevented it
   * being set to, say, 0.5 — which would have auto-approved orders the
   * business rules require a human to confirm. Clamping here means the
   * setting can only tighten the policy.
   */
  private effectiveAutoApproveThreshold(tenantThreshold: number): number {
    const threshold = Number.isFinite(tenantThreshold)
      ? tenantThreshold
      : ConfidenceScorerService.AUTO_APPROVE_FLOOR;

    return Math.max(threshold, ConfidenceScorerService.AUTO_APPROVE_FLOOR);
  }

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

    // 6. Routing, per BUSINESS_RULES.md §10.
    //
    // The previous cutoff was a bare 0.6, which sent every order scoring
    // 0.60–0.79 to ordinary owner review even though §10 requires manual
    // confirmation below 0.80. Anything under the review floor now goes back
    // to the customer for clarification, so no draft is raised on a guess.
    let routing: ConfidenceRouting;

    if (
      extractedOrder.missing_fields.length > 0 ||
      composite < ConfidenceScorerService.HUMAN_REVIEW_FLOOR
    ) {
      routing = 'gather_more_info';
    } else if (
      autoApproveEnabled &&
      composite >= this.effectiveAutoApproveThreshold(autoApproveThreshold)
    ) {
      routing = 'auto_approve';
    } else {
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
