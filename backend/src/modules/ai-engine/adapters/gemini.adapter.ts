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
      const mockResult = this.getMockTextResponse(systemPrompt, userPrompt);
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
        const mockResult = this.getMockTextResponse(systemPrompt, userPrompt);
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
   * Generate an embedding for product catalog RAG.
   * Uses text-embedding-004 (768 dimensions, free).
   *
   * Returns `null` when no embedding can be produced — never a substitute
   * vector. This previously returned `Math.random() - 0.5` values on a missing
   * key OR on any API error, which meant a single transient failure wrote 768
   * dimensions of noise into `products.embedding` permanently. Nothing ever
   * recomputed it, so that product's semantic search was silently poisoned for
   * good, and the only trace was one log line.
   *
   * Callers must treat `null` as "no embedding available" and degrade to text
   * search, which is a correct, visible fallback.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      this.logger.debug(
        '[MOCK AI] No API key — no embedding generated (text search will be used)',
      );
      return null;
    }

    const embeddingModel = this.configService.get<string>(
      'GEMINI_EMBEDDING_MODEL',
      'text-embedding-004',
    );

    try {
      const embeddingClient = this.client.getGenerativeModel({
        model: embeddingModel,
      });

      const result = await this.withRetry(() =>
        embeddingClient.embedContent(text),
      );
      return result.embedding.values;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to generate embedding: ${message}. No embedding stored — ` +
          'the affected product will fall back to text search.',
      );
      return null;
    }
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
  private parseCatalogContext(
    userPrompt: string,
  ): Array<{ id: string; name: string }> {
    const entries: Array<{ id: string; name: string }> = [];
    const pattern =
      /ID:\s*([0-9a-fA-F-]{36})\s*[\r\n]+\s*Name:\s*(.+?)\s*[\r\n]/g;

    for (const match of userPrompt.matchAll(pattern)) {
      entries.push({ id: match[1], name: match[2].trim() });
    }

    return entries;
  }

  /**
   * Isolate the customer's own words from the assembled prompt.
   *
   * The prompt templates embed the tenant catalog *above* the message, so
   * keyword and quantity detection that scans the whole prompt reads the
   * catalog too — list numbers, "LKR 100", "Stock: 10 units" and SKUs all
   * match a bare `\d+`, which made the extracted quantity essentially random.
   * Falls back to the full prompt if neither marker is present.
   */
  private extractCustomerMessage(userPrompt: string): string {
    const match =
      /(?:CUSTOMER MESSAGE|LATEST MESSAGE):\s*"?([\s\S]*?)"?\s*(?:\n\n|$)/.exec(
        userPrompt,
      );

    return match ? match[1].trim() : userPrompt;
  }

  /**
   * Helper to generate mock text responses for intent, extraction, and follow-ups.
   */
  private getMockTextResponse(
    systemPrompt: string,
    userPrompt: string,
  ): string {
    const sys = systemPrompt.toLowerCase();
    const usr = userPrompt.toLowerCase();
    // Everything below reasons about what the *customer* said, so it must read
    // the message alone — not the catalog the prompt builder prepended.
    const customerMessage =
      this.extractCustomerMessage(userPrompt).toLowerCase();

    // 1. Intent Detection
    if (sys.includes('intent') || usr.includes('intent')) {
      const isOrder =
        customerMessage.includes('buy') ||
        customerMessage.includes('mouse') ||
        customerMessage.includes('keyboard') ||
        customerMessage.includes('shoes') ||
        customerMessage.includes('shirt') ||
        customerMessage.includes('order') ||
        customerMessage.includes('yes') ||
        customerMessage.includes('ok');

      return JSON.stringify({
        intent: isOrder ? 'ORDER' : 'OTHER',
        confidence: isOrder ? 0.95 : 0.0,
      });
    }

    // 2. Entity Extraction
    if (
      sys.includes('extract') ||
      usr.includes('extract') ||
      sys.includes('entity')
    ) {
      // Ground the mock ONLY in the tenant-scoped catalog the retriever already
      // injected into this prompt. Previously this opened its own PrismaClient
      // and ran an unfiltered `product.findMany()`, which both leaked other
      // tenants' products into the extraction and leaked connections outside
      // the DI-managed pool.
      const catalog = this.parseCatalogContext(userPrompt);

      const keyword = ['mouse', 'keyboard', 'shoes', 'shirt'].find((k) =>
        customerMessage.includes(k),
      );

      const matchedProduct =
        (keyword
          ? catalog.find((p) => p.name.toLowerCase().includes(keyword))
          : undefined) ??
        catalog[0] ??
        null;

      if (!matchedProduct) {
        this.logger.warn(
          '[MOCK AI] No catalog context in prompt — returning an unmatched extraction',
        );
      }

      // Quantity comes from the customer's message only. Scanning the whole
      // prompt matched catalog digits instead — the list index, "LKR 100",
      // "Stock: 10 units", SKU suffixes — so the quantity was effectively
      // whatever number appeared first in the catalog.
      let quantity: number | null = null;
      const qtyMatch = /\b(\d+)\b/.exec(customerMessage);
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1], 10);
      } else if (
        customerMessage.includes('a ') ||
        customerMessage.includes('one ')
      ) {
        quantity = 1;
      }

      // Report what is genuinely absent. A missing product match must surface
      // as a missing field so the pipeline routes to `gather_more_info` rather
      // than drafting an order against an invented product id — the previous
      // hardcoded UUID fallback fabricated a product that may not exist for
      // this tenant (or at all).
      const missingFields: string[] = [];
      if (!matchedProduct) missingFields.push('product');
      if (quantity === null) missingFields.push('quantity');

      return JSON.stringify({
        items: [
          {
            product_query: keyword ?? matchedProduct?.name ?? 'unknown',
            matched_product_name: matchedProduct?.name ?? null,
            matched_product_id: matchedProduct?.id ?? null,
            match_confidence: matchedProduct ? 0.95 : 0.0,
            quantity,
            selected_attributes: {},
          },
        ],
        delivery_info: {
          address: usr.includes('deliver to')
            ? usr.split('deliver to')[1].trim()
            : null,
        },
        missing_fields: missingFields,
      });
    }

    // 3. Follow-up Question or confirmation request
    if (
      sys.includes('follow-up') ||
      usr.includes('follow-up') ||
      sys.includes('question')
    ) {
      return 'To complete your order, could you please confirm: quantity?';
    }

    return 'I can help you with your order. What would you like to buy?';
  }
}

/**
 * Retained as an alias so existing imports keep working. New code should use
 * `AiResponse` — the shape is provider-neutral and always was.
 */
export type GeminiResponse = AiResponse;
