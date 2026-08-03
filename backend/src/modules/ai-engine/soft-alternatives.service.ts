import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The subset of a retrieved product this needs. */
export interface AlternativeCandidate {
  id: string;
  name: string;
  price: number;
  stockQuantity: number;
}

/**
 * SoftAlternativesService — Phase 2 item 2.5.
 *
 * When the catalogue cannot satisfy a request, the miss is already recorded in
 * `UnfulfilledDemand` — so the shop learns something, but the customer is told
 * nothing useful and simply leaves. A WhatsApp conversation that dead-ends is
 * a lost sale that never appears in any funnel.
 *
 * This turns the dead end into a question, using the products retrieval
 * already fetched. They are the semantically closest items in the catalogue,
 * which is exactly what "close alternative" means — so there is no extra
 * query and no extra model call.
 *
 * Two rules, both about not making the miss worse:
 *
 * 1. **Never offer what cannot ship.** Suggesting a sold-out item is the same
 *    false promise the human-approval design exists to prevent, and it costs
 *    more trust than saying nothing.
 * 2. **Acknowledge before offering.** Leading with alternatives reads as if
 *    the question was ignored.
 *
 * Returns `null` whenever there is nothing honest to say, and the caller
 * falls through to its existing path — a follow-up question, or the handoff
 * to a person.
 */
@Injectable()
export class SoftAlternativesService {
  private readonly logger = new Logger(SoftAlternativesService.name);

  /**
   * Three is a suggestion; ten is a catalogue dump the customer has to wade
   * through on a phone.
   */
  private static readonly MAX_ALTERNATIVES = 3;

  constructor(private readonly configService: ConfigService) {}

  /**
   * @param query      what the customer asked for, in their words
   * @param candidates products retrieval already returned, closest first
   */
  build(query: string, candidates: AlternativeCandidate[]): string | null {
    if (!this.isEnabled()) return null;

    if (!query?.trim()) return null;

    const offerable = candidates
      .filter((c) => c.stockQuantity > 0)
      .slice(0, SoftAlternativesService.MAX_ALTERNATIVES);

    if (offerable.length === 0) {
      this.logger.debug(
        `No in-stock alternatives for "${query}" — caller keeps its own path`,
      );
      return null;
    }

    const list = offerable
      .map((c) => `• ${c.name} — LKR ${c.price}`)
      .join('\n');

    // Their own words first, so it is clear they were understood rather than
    // ignored. Then the offer. Then an explicit invitation to reply, because
    // the dead end is the thing being fixed.
    return (
      `Sorry, we don't have "${query.trim()}" at the moment 😔\n\n` +
      `Here's what we do have that's close:\n${list}\n\n` +
      `Would any of these work for you?`
    );
  }

  private isEnabled(): boolean {
    // On by default: the alternative is a conversation that dead-ends, which
    // is the worse outcome. Set SOFT_ALTERNATIVES_ENABLED=false to restore the
    // old behaviour without a deploy.
    return (
      this.configService.get<string>('SOFT_ALTERNATIVES_ENABLED', 'true') !==
      'false'
    );
  }
}
