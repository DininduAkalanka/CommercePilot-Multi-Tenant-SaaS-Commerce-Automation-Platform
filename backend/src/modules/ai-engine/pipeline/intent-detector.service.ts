import { Injectable, Logger } from '@nestjs/common';
import { GeminiAdapter } from '../adapters/gemini.adapter';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  INTENT_DETECTION_SYSTEM_PROMPT,
  INTENT_DETECTION_USER_PROMPT,
  PROMPT_VERSION,
} from '../prompts/system.prompts';
import { AIProcessingStage } from '@prisma/client';

export type CustomerIntent =
  | 'ORDER'
  | 'INQUIRY'
  | 'COMPLAINT'
  | 'QUOTATION'
  | 'ORDER_STATUS'
  | 'GREETING'
  | 'OTHER';

export interface IntentDetectionResult {
  intent: CustomerIntent;
  confidence: number;
  reasoning: string;
}

/**
 * IntentDetectorService
 *
 * Stage 1 of the AI pipeline.
 * Classifies the customer's message into a business intent category.
 * Only ORDER messages continue through the full pipeline.
 * All other intents are handled by their own workflows.
 */
@Injectable()
export class IntentDetectorService {
  private readonly logger = new Logger(IntentDetectorService.name);

  constructor(
    private readonly gemini: GeminiAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async detect(
    tenantId: string,
    messageId: string,
    messageText: string,
  ): Promise<IntentDetectionResult> {
    const startTime = Date.now();

    this.logger.log(
      `[${tenantId}] Detecting intent for message: ${messageText.substring(0, 50)}...`,
    );

    const systemPrompt = INTENT_DETECTION_SYSTEM_PROMPT;
    const userPrompt = INTENT_DETECTION_USER_PROMPT(messageText);

    const response = await this.gemini.generateText(systemPrompt, userPrompt, {
      temperature: 0.05, // Very low temperature for classification tasks
      maxOutputTokens: 256,
    });

    const processingTimeMs = Date.now() - startTime;

    let result: IntentDetectionResult;

    if (response.success && response.text) {
      try {
        result = this.gemini.parseJsonResponse<IntentDetectionResult>(response.text);
      } catch {
        this.logger.warn('Failed to parse intent JSON, defaulting to OTHER');
        result = { intent: 'OTHER', confidence: 0, reasoning: 'Parse error' };
      }
    } else {
      result = { intent: 'OTHER', confidence: 0, reasoning: response.error ?? 'AI error' };
    }

    // Log this AI processing stage
    await this.prisma.aIProcessingLog.create({
      data: {
        tenantId,
        messageId,
        stage: AIProcessingStage.INTENT_DETECTION,
        inputData: { message: messageText, systemPrompt, userPrompt },
        outputData: result as object,
        modelUsed: response.modelUsed,
        promptVersion: PROMPT_VERSION,
        processingTimeMs,
        tokenCount: response.tokenCount,
        intentConfidence: result.confidence,
        overallConfidence: result.confidence,
        success: response.success,
        errorMessage: response.error,
      },
    });

    this.logger.log(
      `[${tenantId}] Intent: ${result.intent} (confidence: ${result.confidence.toFixed(2)})`,
    );

    return result;
  }
}
