import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/database/prisma.service';
import { AIDraftStatus } from '@prisma/client';

/** One line of an order, in the shape both the extractor and the DB produce. */
export interface ComparableItem {
  productId?: string | null;
  productQuery?: string | null;
  quantity?: number | null;
}

/**
 * DuplicateDetectorService
 *
 * Implements BUSINESS_RULES §18.
 *
 * Only message-level deduplication existed, on `externalMessageId`. That stops
 * the same webhook being processed twice — it does nothing for the case that
 * actually happens: a customer who sends "2 shirts", gets no immediate reply,
 * and sends it again. Two drafts, and on approval two real WooCommerce orders.
 *
 * §18 requires potential duplicates to be FLAGGED FOR OWNER REVIEW, not
 * auto-blocked. Someone genuinely ordering the same thing twice is a real
 * scenario, and silently swallowing the second order would lose a sale. So
 * this never rejects anything; it points the new draft at the suspected
 * original and lets the owner compare.
 */
@Injectable()
export class DuplicateDetectorService {
  private readonly logger = new Logger(DuplicateDetectorService.name);

  /** Statuses worth comparing against. */
  private static readonly LIVE_STATUSES: AIDraftStatus[] = [
    AIDraftStatus.PENDING,
    AIDraftStatus.REVIEWED,
    AIDraftStatus.APPROVED,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * How recent a draft must be to count as a possible duplicate.
   *
   * Ten minutes is the window in which a customer is plausibly still waiting
   * for a reply and repeats themselves. Much longer and genuine re-orders
   * start getting flagged; much shorter and the impatient re-send slips past.
   */
  private get windowMinutes(): number {
    const raw = Number(
      this.configService.get<string>('DUPLICATE_WINDOW_MINUTES', '10'),
    );
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 10;
  }

  private get enabled(): boolean {
    return (
      this.configService.get<string>('DUPLICATE_DETECTION_ENABLED', 'true') !==
      'false'
    );
  }

  /**
   * A stable fingerprint of what was ordered.
   *
   * Sorted so line order does not matter — "2 shirts and a cap" and "a cap and
   * 2 shirts" are the same order. Falls back to the customer's own wording
   * when the extractor matched no product, so unmatched repeats are still
   * caught.
   */
  static signature(items: ComparableItem[]): string | null {
    const parts = items
      .map((item) => {
        const key =
          item.productId ??
          (item.productQuery
            ? `q:${item.productQuery.trim().toLowerCase().replace(/\s+/g, ' ')}`
            : null);

        return key ? `${key}x${item.quantity ?? 1}` : null;
      })
      .filter((part): part is string => part !== null)
      .sort();

    // Nothing identifiable to compare — an empty extraction is not a duplicate
    // of anything, and treating it as one would flag every failed parse.
    return parts.length > 0 ? parts.join('|') : null;
  }

  /**
   * Find a recent draft from the same customer ordering the same things.
   * Returns its id, or null.
   *
   * Never throws: this decorates a draft with a hint. Failing to detect a
   * duplicate must not stop the draft being created.
   */
  async findRecentDuplicate(
    tenantId: string,
    customerId: string,
    items: ComparableItem[],
  ): Promise<string | null> {
    if (!this.enabled) return null;

    const signature = DuplicateDetectorService.signature(items);
    if (!signature) return null;

    try {
      const since = new Date(Date.now() - this.windowMinutes * 60 * 1000);

      const candidates = await this.prisma.aIDraftOrder.findMany({
        where: {
          tenantId,
          customerId,
          createdAt: { gte: since },
          deletedAt: null,
          status: { in: DuplicateDetectorService.LIVE_STATUSES },
        },
        select: {
          id: true,
          items: {
            select: { productId: true, productQuery: true, quantity: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      for (const candidate of candidates) {
        if (DuplicateDetectorService.signature(candidate.items) === signature) {
          this.logger.warn(
            `[${tenantId}] Draft for customer ${customerId} looks like a repeat of ${candidate.id} — flagging for owner review`,
          );
          return candidate.id;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Duplicate detection failed: ${String(error)}`);
      return null;
    }
  }
}
