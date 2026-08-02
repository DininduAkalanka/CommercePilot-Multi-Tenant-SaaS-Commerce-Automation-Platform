import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerationConfig,
} from '@google/generative-ai';

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
export class GeminiAdapter {
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
    config?: Partial<GenerationConfig>,
  ): Promise<GeminiResponse> {
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
      const generationConfig: GenerationConfig = {
        temperature: parseFloat(
          this.configService.get('GEMINI_TEMPERATURE', '0.1'),
        ),
        maxOutputTokens: parseInt(
          this.configService.get('GEMINI_MAX_TOKENS', '2048'),
        ),
        ...config,
      };

      const result = await this.model.generateContent({
        systemInstruction: systemPrompt,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig,
      });

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
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return JSON.parse(cleaned) as T;
  }

  /**
   * Generate embeddings for product catalog RAG.
   * Uses text-embedding-004 (768 dimensions, free).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      return new Array(768).fill(0).map(() => Math.random() - 0.5);
    }

    try {
      const embeddingModel = this.configService.get<string>(
        'GEMINI_EMBEDDING_MODEL',
        'text-embedding-004',
      );

      const embeddingClient = this.client.getGenerativeModel({
        model: embeddingModel,
      });

      const result = await embeddingClient.embedContent(text);
      return result.embedding.values;
    } catch (err: any) {
      this.logger.error(
        `Failed to generate embedding: ${err.message}. Falling back to mock embedding.`,
      );
      return new Array(768).fill(0).map(() => Math.random() - 0.5);
    }
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

export interface GeminiResponse {
  text: string;
  modelUsed: string;
  processingTimeMs: number;
  tokenCount?: number;
  success: boolean;
  error?: string;
}
