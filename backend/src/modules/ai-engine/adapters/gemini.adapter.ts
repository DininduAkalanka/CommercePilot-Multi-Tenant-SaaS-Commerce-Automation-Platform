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
    this.modelName = this.configService.get<string>('GEMINI_MODEL', 'gemini-1.5-flash');

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
      this.logger.log(`[MOCK AI] Running in mock generative mode (key is placeholder/empty)`);
      const mockResult = await this.getMockTextResponse(systemPrompt, userPrompt);
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Gemini API error: ${errorMessage}`);

      // Fallback to mock response on API key validation errors so the simulator remains testable
      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
        this.logger.log(`[MOCK AI] API key invalid, falling back to mock response`);
        const mockResult = await this.getMockTextResponse(systemPrompt, userPrompt);
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
      this.logger.error(`Failed to generate embedding: ${err.message}. Falling back to mock embedding.`);
      return new Array(768).fill(0).map(() => Math.random() - 0.5);
    }
  }

  /**
   * Helper to generate mock text responses for intent, extraction, and follow-ups.
   */
  private async getMockTextResponse(systemPrompt: string, userPrompt: string): Promise<string> {
    const sys = systemPrompt.toLowerCase();
    const usr = userPrompt.toLowerCase();

    // 1. Intent Detection
    if (sys.includes('intent') || usr.includes('intent')) {
      const isOrder =
        usr.includes('buy') ||
        usr.includes('mouse') ||
        usr.includes('keyboard') ||
        usr.includes('shoes') ||
        usr.includes('shirt') ||
        usr.includes('order') ||
        usr.includes('yes') ||
        usr.includes('ok');

      return JSON.stringify({
        intent: isOrder ? 'ORDER' : 'OTHER',
        confidence: isOrder ? 0.95 : 0.00,
      });
    }

    // 2. Entity Extraction
    if (sys.includes('extract') || usr.includes('extract') || sys.includes('entity')) {
      // Dynamic database product catalog matching using a local Prisma instance
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      let matchedProduct: any = null;

      try {
        const dbProducts = await prisma.product.findMany();
        if (usr.includes('mouse')) {
          matchedProduct = dbProducts.find((p: any) => p.name.toLowerCase().includes('mouse')) || dbProducts[0];
        } else if (usr.includes('keyboard')) {
          matchedProduct = dbProducts.find((p: any) => p.name.toLowerCase().includes('keyboard')) || dbProducts[0];
        } else if (usr.includes('shoes')) {
          matchedProduct = dbProducts.find((p: any) => p.name.toLowerCase().includes('shoes')) || dbProducts[0];
        } else {
          matchedProduct = dbProducts[0];
        }
      } catch (err) {
        this.logger.warn(`Failed to connect to database in mock RAG mode: ${err.message}`);
      } finally {
        await prisma.$disconnect();
      }

      // Check for quantity digits
      let quantity: number | null = null;
      const qtyMatch = usr.match(/\b(\d+)\b/);
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1]);
      } else if (usr.includes('a ') || usr.includes('one ')) {
        quantity = 1;
      }

      const hasRequiredFields = quantity !== null;

      return JSON.stringify({
        items: [
          {
            product_query: usr.includes('mouse') ? 'mouse' : usr.includes('keyboard') ? 'keyboard' : 'shoes',
            matched_product_name: matchedProduct ? matchedProduct.name : 'Wireless Mouse',
            matched_product_id: matchedProduct ? matchedProduct.id : 'eeebc3a0-12d4-4b82-98dd-dff51b41700a',
            match_confidence: 0.95,
            quantity,
            selected_attributes: {},
          },
        ],
        delivery_info: {
          address: usr.includes('deliver to') ? usr.split('deliver to')[1].trim() : null,
        },
        missing_fields: hasRequiredFields ? [] : ['quantity'],
      });
    }

    // 3. Follow-up Question or confirmation request
    if (sys.includes('follow-up') || usr.includes('follow-up') || sys.includes('question')) {
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
