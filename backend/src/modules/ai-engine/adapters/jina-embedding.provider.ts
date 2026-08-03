import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from './embedding-provider.interface';

/**
 * JinaEmbeddingProvider
 *
 * Chosen because it emits 768 dimensions on request. `products.embedding` is
 * `vector(768)` with an HNSW index built for that width, so a provider fixed
 * at 1024 (Cohere v3, OpenAI) would have forced a migration, a new index, and
 * a full re-embed of every catalogue row. Free tier, no card, reachable from
 * Sri Lanka.
 *
 * ## Measured behaviour, not assumed
 *
 * Verified against the live API before this was written, on realistic catalogue
 * text rather than bare labels:
 *
 * - English and Singlish retrieval is strong. `mata blue shirt ekak one` ->
 *   "Blue Cotton Shirt" scored 0.628 with a 0.322 margin over the runner-up.
 * - Sinhala script does not work. Every Sinhala query ranked the same
 *   unrelated product first, with margins of 0.005-0.035 — noise, not ranking.
 *   Neither shorter product text nor the asymmetric `retrieval.*` tasks fixed
 *   it; `retrieval.query` scored Sinhala *negatively*.
 * - Normalising the query to English through the LLM first fixes it
 *   completely: the same queries then scored 0.867-0.888 with margins above
 *   0.42. That normalisation belongs upstream in the pipeline, not here — this
 *   class embeds whatever text it is given.
 *
 * `task: 'text-matching'` is therefore deliberate and measured, not a default.
 */
@Injectable()
export class JinaEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(JinaEmbeddingProvider.name);

  private static readonly ENDPOINT = 'https://api.jina.ai/v1/embeddings';
  private static readonly PLACEHOLDER = 'PASTE_YOUR_JINA_KEY_HERE';

  readonly dimensions: number;

  constructor(private readonly configService: ConfigService) {
    this.dimensions = Number(this.configService.get('JINA_DIMENSIONS', '768'));
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    const [result] = await this.generateEmbeddings([text]);

    return result ?? null;
  }

  async generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];

    const nulls = () => texts.map(() => null);
    const apiKey = this.apiKey();

    if (!apiKey) {
      this.logger.debug(
        'No Jina key configured — no embeddings generated ' +
          '(product search will use text matching)',
      );
      return nulls();
    }

    // Embedding whitespace burns free-tier quota and produces a vector that
    // still ranks against the catalogue.
    if (texts.every((t) => !t?.trim())) return nulls();

    const model = this.configService.get<string>(
      'JINA_MODEL',
      'jina-embeddings-v3',
    );

    try {
      const payload = await this.withRetry(async () => {
        const response = await this.post(apiKey, {
          model,
          // Measured: strictly better than retrieval.query/retrieval.passage
          // on this catalogue. See the class comment.
          task: 'text-matching',
          dimensions: this.dimensions,
          input: texts,
        });

        if (!response.ok) {
          throw new HttpFailure(
            response.status,
            await this.errorDetail(response),
          );
        }

        return (await response.json()) as JinaResponse;
      });

      // Results are placed by the API's own `index`, never by arrival order.
      // The backfill zips these against product ids, so a misalignment would
      // attach one product's embedding to another — permanently wrong search
      // with nothing to indicate it.
      const out: (number[] | null)[] = texts.map(() => null);

      for (const entry of payload?.data ?? []) {
        const at = entry?.index;
        if (typeof at !== 'number' || at < 0 || at >= texts.length) continue;

        out[at] = this.validate(entry.embedding);
      }

      return out;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to generate embeddings: ${message}. Nothing stored — ` +
          'the affected products fall back to text search.',
      );

      return nulls();
    }
  }

  // ── internals ───────────────────────────────────────────────────

  /**
   * A vector of the wrong width must never reach the database. Postgres would
   * reject it against `vector(768)` at write time, but the failure would
   * surface far from its cause; and if the column were ever widened, a
   * mismatched vector would silently corrupt every similarity score instead.
   */
  private validate(embedding: unknown): number[] | null {
    if (!Array.isArray(embedding)) return null;

    if (embedding.length !== this.dimensions) {
      this.logger.error(
        `Jina returned ${embedding.length} dimensions, expected ` +
          `${this.dimensions} — discarding. Check JINA_DIMENSIONS against ` +
          'the products.embedding column width.',
      );
      return null;
    }

    if (!embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      this.logger.error('Jina returned a non-numeric vector — discarding');
      return null;
    }

    return embedding as number[];
  }

  private apiKey(): string | null {
    const key = this.configService.get<string>('JINA_API_KEY');

    if (!key || key === JinaEmbeddingProvider.PLACEHOLDER) return null;

    return key;
  }

  private async post(
    apiKey: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const timeoutMs = Number(
      this.configService.get('JINA_TIMEOUT_MS', '30000'),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(JinaEmbeddingProvider.ENDPOINT, {
        method: 'POST',
        headers: {
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
      const body = (await response.json()) as {
        detail?: string;
        error?: { message?: string };
      };
      return body?.detail ?? body?.error?.message ?? `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  /** Retries rate limits and server errors; a bad key fails immediately. */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = Number(
      this.configService.get('JINA_MAX_ATTEMPTS', '3'),
    );
    const baseDelayMs = Number(
      this.configService.get('JINA_RETRY_BASE_MS', '500'),
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
          `Jina attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private isTransient(error: unknown): boolean {
    if (error instanceof HttpFailure) {
      return (
        error.status === 408 || error.status === 429 || error.status >= 500
      );
    }

    return true;
  }
}

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpFailure';
  }
}

interface JinaResponse {
  data?: { embedding?: unknown; index?: number }[];
  usage?: { total_tokens?: number };
}
