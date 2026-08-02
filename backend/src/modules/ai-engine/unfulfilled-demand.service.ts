import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { UnfulfilledReason } from '@prisma/client';

export interface DemandRecord {
  tenantId: string;
  customerId?: string | null;
  messageId?: string | null;
  query: string;
  reason: UnfulfilledReason;
}

export interface DemandSummaryRow {
  query: string;
  requests: number;
  customers: number;
  reason: UnfulfilledReason;
  firstAskedAt: string;
  lastAskedAt: string;
}

export interface DemandSummary {
  period: { days: number; from: string; to: string };
  totalRequests: number;
  distinctQueries: number;
  top: DemandSummaryRow[];
}

/**
 * UnfulfilledDemandService
 *
 * Turns failed product matches into a stocking signal.
 *
 * A message the AI could not match is normally treated as an error to be
 * logged and forgotten. But the customer was not wrong — they wanted to buy
 * something, said so clearly enough for a human to understand, and the
 * business could not sell it to them. That is demand, and it is the only kind
 * that arrives pre-qualified with a real customer attached.
 *
 * Aggregated it answers a question the owner cannot otherwise ask:
 * "what are people asking me for that I do not stock?"
 */
@Injectable()
export class UnfulfilledDemandService {
  private readonly logger = new Logger(UnfulfilledDemandService.name);

  private static readonly MAX_DAYS = 365;
  private static readonly MAX_QUERY_LENGTH = 120;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Collapse a query so equivalent phrasings aggregate together.
   *
   * "Red Saree", "red  saree" and " RED saree " are one product to the owner
   * reading the report, so they must be one row in it.
   */
  static normalize(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Record demand the catalog could not satisfy.
   *
   * Deliberately never throws: this is an observability side-effect inside the
   * message-processing path, and failing to record a statistic must not cost a
   * customer their reply.
   */
  async record(demand: DemandRecord): Promise<void> {
    const query = demand.query?.trim();

    // A blank or single-character query is extractor noise, not a product
    // someone asked for. Recording it would only add junk to the report.
    if (!query || query.length < 2) return;

    try {
      await this.prisma.unfulfilledDemand.create({
        data: {
          tenantId: demand.tenantId,
          customerId: demand.customerId ?? null,
          messageId: demand.messageId ?? null,
          query: query.slice(0, UnfulfilledDemandService.MAX_QUERY_LENGTH),
          normalizedQuery: UnfulfilledDemandService.normalize(query).slice(
            0,
            UnfulfilledDemandService.MAX_QUERY_LENGTH,
          ),
          reason: demand.reason,
        },
      });

      this.logger.log(
        `[${demand.tenantId}] Unfulfilled demand recorded: "${query}" (${demand.reason})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record unfulfilled demand: ${String(error)}`,
      );
    }
  }

  /**
   * What customers asked for and could not get, most requested first.
   *
   * Ordered by distinct CUSTOMERS rather than raw request count: one frustrated
   * person messaging five times is a worse stocking signal than five different
   * people asking once each.
   */
  async getSummary(
    tenantId: string,
    days = 30,
    limit = 20,
  ): Promise<DemandSummary> {
    const windowDays = Math.min(
      Math.max(Math.trunc(days) || 1, 1),
      UnfulfilledDemandService.MAX_DAYS,
    );

    const to = new Date();
    const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.unfulfilledDemand.groupBy({
      by: ['normalizedQuery', 'reason'],
      where: { tenantId, createdAt: { gte: from } },
      _count: { _all: true },
      _min: { createdAt: true, query: true },
      _max: { createdAt: true },
      orderBy: { _count: { normalizedQuery: 'desc' } },
      take: Math.min(Math.max(Math.trunc(limit) || 20, 1), 100),
    });

    // Distinct customers per query needs a second pass: Prisma's groupBy
    // cannot express COUNT(DISTINCT customerId) alongside the grouping.
    const distinctCustomers = await this.countDistinctCustomers(
      tenantId,
      from,
      rows.map((r) => r.normalizedQuery),
    );

    const [totalRequests, distinctQueries] = await Promise.all([
      this.prisma.unfulfilledDemand.count({
        where: { tenantId, createdAt: { gte: from } },
      }),
      this.prisma.unfulfilledDemand
        .groupBy({
          by: ['normalizedQuery'],
          where: { tenantId, createdAt: { gte: from } },
        })
        .then((g) => g.length),
    ]);

    const top: DemandSummaryRow[] = rows
      .map((r) => ({
        // Show the customer's original casing, not the normalised form.
        query: r._min.query ?? r.normalizedQuery,
        requests: r._count._all,
        customers: distinctCustomers.get(r.normalizedQuery) ?? 0,
        reason: r.reason,
        firstAskedAt: (r._min.createdAt ?? from).toISOString(),
        lastAskedAt: (r._max.createdAt ?? from).toISOString(),
      }))
      .sort((a, b) => b.customers - a.customers || b.requests - a.requests);

    return {
      period: {
        days: windowDays,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      totalRequests,
      distinctQueries,
      top,
    };
  }

  private async countDistinctCustomers(
    tenantId: string,
    from: Date,
    queries: string[],
  ): Promise<Map<string, number>> {
    if (queries.length === 0) return new Map();

    const rows = await this.prisma.unfulfilledDemand.findMany({
      where: {
        tenantId,
        createdAt: { gte: from },
        normalizedQuery: { in: queries },
      },
      select: { normalizedQuery: true, customerId: true },
    });

    const seen = new Map<string, Set<string>>();
    for (const row of rows) {
      // An anonymous request still represents a person, so count it once
      // rather than dropping it.
      const key = row.customerId ?? `anon:${row.normalizedQuery}`;
      const set = seen.get(row.normalizedQuery) ?? new Set<string>();
      set.add(key);
      seen.set(row.normalizedQuery, set);
    }

    return new Map([...seen].map(([query, set]) => [query, set.size]));
  }
}
