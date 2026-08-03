import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiAdapter,
  AiGenerationConfig,
  AiResponse,
  parseJsonFromModelText,
} from './ai-adapter.interface';

/**
 * GroqAdapter
 *
 * Groq's free tier serves Sri Lanka; Gemini's does not. A Gemini key created
 * here lists all 50 models and then returns
 * `limit: 0, metric: generate_content_free_tier_requests` on the first real
 * call — the free tier is region-gated, and paid access needs a card that is
 * hard to obtain locally. That is why this adapter exists.
 *
 * Verified against the live API before this was written: key valid, ~200ms,
 * valid JSON on English, Sinhala and Singlish input.
 *
 * Uses the OpenAI-compatible REST endpoint over `fetch` rather than a vendor
 * SDK — the payload shape was confirmed by hand, and an SDK would add a
 * dependency for one HTTP POST.
 *
 * Text generation only. Groq serves no embedding models, so embeddings come
 * from a separate `EmbeddingProvider` — see embedding-provider.interface.ts.
 */
@Injectable()
export class GroqAdapter implements AiAdapter {
  private readonly logger = new Logger(GroqAdapter.name);

  private static readonly ENDPOINT =
    'https://api.groq.com/openai/v1/chat/completions';

  /** Placeholder written into `.env` for contributors without a key. */
  private static readonly PLACEHOLDER = 'PASTE_YOUR_GROQ_KEY_HERE';

  constructor(private readonly configService: ConfigService) {}

  async generateText(
    systemPrompt: string,
    userPrompt: string,
    config?: AiGenerationConfig,
  ): Promise<AiResponse> {
    const startTime = Date.now();
    const apiKey = this.apiKey();
    const modelName = this.configService.get<string>(
      'GROQ_MODEL',
      'llama-3.3-70b-versatile',
    );

    if (!apiKey) {
      this.logger.log(
        '[MOCK AI] No Groq key configured — returning a canned response',
      );

      return {
        text: this.mockResponse(userPrompt),
        modelUsed: 'mock-groq',
        processingTimeMs: Date.now() - startTime,
        tokenCount: 0,
        success: true,
      };
    }

    const body: Record<string, unknown> = {
      model: modelName,
      messages: [
        // Kept as distinct roles: merging them into one user turn measurably
        // degrades instruction following on the smaller free-tier models.
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config?.temperature ?? 0.1,
      max_tokens: config?.maxOutputTokens ?? 2048,
    };

    if (config?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    try {
      const text = await this.withRetry(async () => {
        const response = await this.fetchWithTimeout(apiKey, body);

        if (!response.ok) {
          const detail = await this.errorDetail(response);
          throw new HttpFailure(response.status, detail);
        }

        const payload = (await response.json()) as GroqCompletion;
        const content = payload?.choices?.[0]?.message?.content;

        if (typeof content !== 'string') {
          // A 200 with an unrecognised shape means the API changed under us.
          // Failing here is better than passing `undefined` down the pipeline.
          throw new HttpFailure(200, 'Groq returned no completion content');
        }

        return { content, tokens: payload.usage?.total_tokens };
      });

      const processingTimeMs = Date.now() - startTime;
      this.logger.debug(
        `Groq response in ${processingTimeMs}ms (${text.content.length} chars)`,
      );

      return {
        text: text.content,
        modelUsed: modelName,
        processingTimeMs,
        tokenCount: text.tokens,
        success: true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Groq API error: ${message}`);

      // Deliberately does not rethrow. One provider failure must degrade this
      // stage, not abort the customer's order.
      return {
        text: '',
        modelUsed: modelName,
        processingTimeMs: Date.now() - startTime,
        success: false,
        error: message,
      };
    }
  }

  parseJsonResponse<T>(text: string): T {
    return parseJsonFromModelText<T>(text);
  }

  // ── internals ───────────────────────────────────────────────────

  /** Returns the configured key, or null when unset/placeholder. */
  private apiKey(): string | null {
    const key = this.configService.get<string>('GROQ_API_KEY');

    if (!key || key === GroqAdapter.PLACEHOLDER) return null;

    return key;
  }

  private async fetchWithTimeout(
    apiKey: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const timeoutMs = Number(
      this.configService.get('GROQ_TIMEOUT_MS', '20000'),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(GroqAdapter.ENDPOINT, {
        method: 'POST',
        headers: {
          // Bearer header, never a query parameter — keys in URLs leak into
          // proxy logs and error reports.
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorDetail(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      return body?.error?.message ?? `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  /**
   * Bounded retries with exponential backoff, transient failures only.
   *
   * The free tier rate-limits aggressively and a burst of WhatsApp messages
   * hits 429 routinely. Retrying a 400 or 401 would burn quota and delay a
   * clear error, so those fail immediately.
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = Number(
      this.configService.get('GROQ_MAX_ATTEMPTS', '3'),
    );
    const baseDelayMs = Number(
      this.configService.get('GROQ_RETRY_BASE_MS', '500'),
    );

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;

        if (!this.isTransient(error) || attempt === maxAttempts) break;

        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Groq attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private isTransient(error: unknown): boolean {
    if (error instanceof HttpFailure) {
      // 408 request timeout, 429 rate limit, 5xx server-side.
      return (
        error.status === 408 || error.status === 429 || error.status >= 500
      );
    }

    // Network errors and aborts have no status and are worth one more try.
    return true;
  }

  /**
   * Canned response so the pipeline runs without credentials. Intentionally
   * crude — it exists so contributors can boot the stack, not to simulate the
   * model. Anything measured against it is meaningless, which `npm run eval`
   * warns about explicitly.
   */
  private mockResponse(userPrompt: string): string {
    const message = userPrompt.toLowerCase();
    const looksLikeOrder =
      message.includes('order') ||
      message.includes('buy') ||
      message.includes('want') ||
      message.includes('one') || // "ekak one" — Singlish "I want one"
      message.includes('denna'); // Singlish "give me"

    return JSON.stringify({
      intent: looksLikeOrder ? 'ORDER' : 'INQUIRY',
      items: [],
      confidence: 0.5,
      _mock: true,
    });
  }
}

/** Carries the HTTP status so retry policy can distinguish transient failures. */
class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpFailure';
  }
}

interface GroqCompletion {
  choices?: { message?: { content?: string } }[];
  usage?: { total_tokens?: number };
}
