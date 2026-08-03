/**
 * The contract every AI provider must satisfy.
 *
 * Services depend on this, never on a concrete provider, so the provider can
 * change without touching the pipeline. That is not hypothetical here: the
 * Gemini free tier returns `limit: 0` in Sri Lanka, so the product had to move
 * to Groq without rewriting five services.
 *
 * Deliberately narrow. Anything provider-specific (Gemini's safety settings,
 * Groq's seed) belongs in the adapter, not in this interface — the moment a
 * provider's vocabulary leaks in here, callers start depending on it and the
 * abstraction stops being worth having.
 */

/** DI token. Injected instead of a concrete class so the provider is swappable. */
export const AI_ADAPTER = 'AI_ADAPTER';

/**
 * Generation knobs that every provider understands.
 *
 * Named after Gemini's fields because those were already in use at the call
 * sites; adapters translate to their own vocabulary.
 */
export interface AiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the provider to guarantee syntactically valid JSON, where supported. */
  jsonMode?: boolean;
}

export interface AiResponse {
  text: string;
  modelUsed: string;
  processingTimeMs: number;
  tokenCount?: number;
  success: boolean;
  error?: string;
}

export interface AiAdapter {
  /**
   * Never throws. A provider failure returns `success: false` with the text
   * the caller should fall back to, because one failed call must not take down
   * a customer's whole order pipeline.
   */
  generateText(
    systemPrompt: string,
    userPrompt: string,
    config?: AiGenerationConfig,
  ): Promise<AiResponse>;

  /**
   * `null` means "no embedding available" — not an error, and never a
   * fabricated vector. Callers degrade to text search, which is correct and
   * visible. Providers without embedding models (Groq) always return null.
   */
  generateEmbedding(text: string): Promise<number[] | null>;

  /**
   * Parse a model's text response as JSON. Throws on genuinely invalid JSON,
   * which callers already handle as a failed extraction.
   */
  parseJsonResponse<T>(text: string): T;
}

/**
 * Shared JSON extraction, used by every adapter.
 *
 * Models wrap JSON in markdown fences even when instructed not to, and even
 * with a JSON response format set. Left unstripped, `JSON.parse` throws and a
 * perfectly good extraction is discarded. This is response-shape handling
 * rather than provider behaviour, so it lives once here instead of being
 * copied — and drifting — per adapter.
 */
export function parseJsonFromModelText<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(cleaned) as T;
}
