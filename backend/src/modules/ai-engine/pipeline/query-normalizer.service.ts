import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_ADAPTER } from '../adapters/ai-adapter.interface';
import type { AiAdapter } from '../adapters/ai-adapter.interface';

/**
 * QueryNormalizerService
 *
 * Turns a non-Latin-script message into a short English search phrase before
 * retrieval runs.
 *
 * ## The failure this fixes
 *
 * Text search tokenises on `[^a-z0-9]`, which strips every Sinhala character,
 * so a Sinhala message yields zero search terms and matches nothing. Vector
 * search does not save it either: embeddings of Sinhala script rank the same
 * unrelated product first regardless of meaning (measured margins of
 * 0.005-0.035 — noise), and with no embedding provider configured it returns
 * null anyway. A Sinhala customer therefore gets no products at all.
 *
 * ## Why translation rather than a better embedding model
 *
 * Measured on the real catalogue: normalising to English took vector-search
 * margins from 0.010 to 0.421 and text-search terms from 0 to 2. The same LLM
 * that mislabels colours during full order extraction translates these phrases
 * correctly, because translating is a far narrower task than extracting a
 * structured order. Splitting the step is what makes it reliable.
 *
 * It also means the embedding model no longer has to be multilingual — by the
 * time text reaches it, it is already English.
 *
 * ## Principle
 *
 * Normalisation is an enhancement and must never make retrieval worse than the
 * raw message. Every failure path returns the original untouched.
 */
@Injectable()
export class QueryNormalizerService {
  private readonly logger = new Logger(QueryNormalizerService.name);

  /**
   * Longest believable search phrase. Told to answer with a short phrase,
   * models sometimes explain themselves instead; searching on that prose is
   * worse than searching on the original.
   */
  private static readonly MAX_LENGTH = 60;

  /**
   * Every clause here was added to fix a specific measured failure, not from
   * general prompt-writing instinct:
   *
   * - The retail framing: without it, `රතු ගවුම` ("red gown") came back as
   *   "red cow" — the model split ගවුම into ගව (cattle). Naming the domain
   *   and ruling out animals fixed it.
   * - The second, colourless example: with only the "red dress" example,
   *   `මට ගවුමක් ඕන` ("I want a dress") returned "red dress", inventing a
   *   colour the customer never asked for and narrowing retrieval to the
   *   wrong products. It also removed a spurious "size 2" the model was
   *   deriving from a quantity.
   */
  private static readonly SYSTEM_PROMPT =
    'You translate Sinhala, Tamil and Singlish shopping messages into short ' +
    'English product search phrases for a clothing and general retail shop. ' +
    'The text always refers to a PRODUCT for sale, never to animals, people ' +
    'or places. Reply with ONLY the phrase — no punctuation, no quotes, no ' +
    'explanation. Keep it under six words. Include a colour or size ONLY if ' +
    'the message mentions one. Examples: "mata rathu gawumak one" -> red ' +
    'dress; "mata gawumak one" -> dress';

  constructor(
    @Inject(AI_ADAPTER) private readonly ai: AiAdapter,
    private readonly configService: ConfigService,
  ) {}

  async normalize(message: string): Promise<string> {
    if (!message?.trim()) return message;

    if (!this.isEnabled()) return message;

    // Latin-script messages are left alone. English tokenises correctly
    // already, and Singlish was measured retrieving well (0.628, margin
    // 0.322) — spending a call and risking a bad rewrite would be a
    // downgrade. This targets only what is actually broken.
    if (!this.needsNormalizing(message)) return message;

    try {
      const response = await this.ai.generateText(
        QueryNormalizerService.SYSTEM_PROMPT,
        message,
        // Translation, not creativity. The token cap bounds a runaway reply.
        { temperature: 0, maxOutputTokens: 32 },
      );

      if (!response.success) {
        this.logger.warn(
          `Normalisation failed (${response.error ?? 'unknown'}) — ` +
            'searching on the original message',
        );
        return message;
      }

      const cleaned = this.clean(response.text);

      if (!this.isUsable(cleaned)) {
        this.logger.warn(
          'Normalisation produced an unusable result — ' +
            'searching on the original message',
        );
        return message;
      }

      this.logger.debug(`Normalised "${message}" -> "${cleaned}"`);

      return cleaned;
    } catch (error: unknown) {
      // Retrieval must not lose an order because normalisation broke.
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Normalisation threw (${detail}) — searching on the original message`,
      );

      return message;
    }
  }

  // ── internals ───────────────────────────────────────────────────

  private isEnabled(): boolean {
    // Defaults to on: the failure it fixes is total, not marginal. Set
    // QUERY_NORMALIZATION_ENABLED=false to restore the old behaviour without
    // a deploy.
    return (
      this.configService.get<string>('QUERY_NORMALIZATION_ENABLED', 'true') !==
      'false'
    );
  }

  /**
   * True when the message contains a character from a non-Latin script —
   * Sinhala, Tamil, or anything else the `[^a-z0-9]` tokeniser would discard.
   *
   * Matched by Unicode script rather than a codepoint range. A range-based
   * test classifies emoji and control characters as non-Latin, which would
   * spend a model call on every message containing one. Digits, punctuation,
   * whitespace and emoji are all Script=Common and correctly ignored here.
   */
  private needsNormalizing(message: string): boolean {
    return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(
      message,
    );
  }

  private clean(text: string): string {
    return text
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/[.!?]+$/, '')
      .trim();
  }

  /**
   * A result is only usable if it is short and actually Latin script. A model
   * that echoes the input back has achieved nothing — that text would still
   * tokenise to zero terms.
   */
  private isUsable(candidate: string): boolean {
    if (!candidate) return false;

    if (candidate.length > QueryNormalizerService.MAX_LENGTH) return false;

    return !this.needsNormalizing(candidate);
  }
}
