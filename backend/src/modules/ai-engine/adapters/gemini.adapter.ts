import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerationConfig,
} from '@google/generative-ai';
import {
  AiAdapter,
  AiGenerationConfig,
  AiResponse,
  parseJsonFromModelText,
} from './ai-adapter.interface';
import { buildMockResponse } from './mock-ai';

/**
 * GeminiAdapter
 *
 * Abstracted interface to Google Gemini Flash API.
 * All AI calls go through here — never call Gemini SDK directly from services.
 *
 * Free tier: Gemini 1.5 Flash
 * - 1M tokens/day free
 * - 15 requests/minute
 * - No credit card required
 */
@Injectable()
export class GeminiAdapter implements AiAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly client: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly modelName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.modelName = this.configService.get<string>(
      'GEMINI_MODEL',
      'gemini-1.5-flash',
    );

    this.client = new GoogleGenerativeAI(apiKey || 'dummy-key');
    this.model = this.client.getGenerativeModel({
      model: this.modelName,
    });
  }

  /**
   * Generate a text response from Gemini.
   * Returns the raw text and usage metadata.
   */
  async generateText(
    systemPrompt: string,
    userPrompt: string,
    config?: AiGenerationConfig,
  ): Promise<AiResponse> {
    const startTime = Date.now();
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    const isMockMode = !apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE';

    if (isMockMode) {
      this.logger.log(
        `[MOCK AI] Running in mock generative mode (key is placeholder/empty)`,
      );
      const mockResult = buildMockResponse(systemPrompt, userPrompt);
      return {
        text: mockResult,
        modelUsed: 'mock-gemini-v2',
        processingTimeMs: Date.now() - startTime,
        tokenCount: 100,
        success: true,
      };
    }

    try {
      // Mapped field by field rather than spread: the neutral config carries
      // `jsonMode`, which is not a Gemini field and would leak into the SDK
      // payload.
      const generationConfig: GenerationConfig = {
        temperature:
          config?.temperature ??
          parseFloat(this.configService.get('GEMINI_TEMPERATURE', '0.1')),
        maxOutputTokens:
          config?.maxOutputTokens ??
          parseInt(this.configService.get('GEMINI_MAX_TOKENS', '2048')),
        ...(config?.jsonMode ? { responseMimeType: 'application/json' } : {}),
      };

      const result = await this.withRetry(() =>
        this.model.generateContent({
          systemInstruction: systemPrompt,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig,
        }),
      );

      const response = result.response;
      const text = response.text();
      const processingTimeMs = Date.now() - startTime;

      this.logger.debug(
        `Gemini response in ${processingTimeMs}ms (${text.length} chars)`,
      );

      return {
        text,
        modelUsed: this.modelName,
        processingTimeMs,
        tokenCount: response.usageMetadata?.totalTokenCount,
        success: true,
      };
    } catch (error: unknown) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Gemini API error: ${errorMessage}`);

      // Fallback to mock response on API key validation errors so the simulator remains testable
      if (
        errorMessage.includes('API_KEY_INVALID') ||
        errorMessage.includes('API key not valid')
      ) {
        this.logger.log(
          `[MOCK AI] API key invalid, falling back to mock response`,
        );
        const mockResult = buildMockResponse(systemPrompt, userPrompt);
        return {
          text: mockResult,
          modelUsed: 'mock-gemini-v2',
          processingTimeMs,
          tokenCount: 100,
          success: true,
        };
      }

      return {
        text: '',
        modelUsed: this.modelName,
        processingTimeMs,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Parse a JSON response from Gemini.
   * Strips markdown code fences that Gemini sometimes adds.
   */
  parseJsonResponse<T>(text: string): T {
    return parseJsonFromModelText<T>(text);
  }

  /**
   * Run an API call with a timeout and bounded retries.
   *
   * Gemini's free tier allows 15 requests/minute; a burst of WhatsApp messages
   * trivially exceeds that and returns 429. Without this, a single rate-limit
   * response failed the whole pipeline stage for that customer's order.
   * Retries use exponential backoff and only cover transient classes —
   * a 400 or an invalid key fails immediately rather than being retried.
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = Number(
      this.configService.get('GEMINI_MAX_ATTEMPTS', '3'),
    );
    const timeoutMs = Number(
      this.configService.get('GEMINI_TIMEOUT_MS', '20000'),
    );

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.withTimeout(operation(), timeoutMs);
      } catch (err: unknown) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);

        const isTransient =
          message.includes('429') ||
          message.includes('RESOURCE_EXHAUSTED') ||
          message.includes('500') ||
          message.includes('503') ||
          message.includes('UNAVAILABLE') ||
          message.includes('timed out');

        if (!isTransient || attempt === maxAttempts) {
          throw err;
        }

        const backoffMs = 500 * 2 ** (attempt - 1);
        this.logger.warn(
          `Gemini call failed (attempt ${attempt}/${maxAttempts}): ${message}. ` +
            `Retrying in ${backoffMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
  }

  /** Reject if the SDK call hangs — it has no default timeout of its own. */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Gemini request timed out after ${ms}ms`)),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          // Preserve the original Error (withRetry inspects err.message to
          // decide whether the failure is transient); normalise anything else.
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  /**
   * Parse the RAG catalog block that ProductRetrieverService formats into the
   * user prompt (`formatCatalogContext`), which looks like:
   *
   *   1. ID: 3f2a...-...
   *      Name: Wireless Mouse
   *      SKU: WM-01
   *
   * This is the ONLY product source the mock is allowed to use. That block is
   * already filtered to the calling tenant, so grounding the mock in it keeps
   * mock mode inside the same tenant boundary as real mode.
   */
}

/**
 * Retained as an alias so existing imports keep working. New code should use
 * `AiResponse` — the shape is provider-neutral and always was.
 */
export type GeminiResponse = AiResponse;
