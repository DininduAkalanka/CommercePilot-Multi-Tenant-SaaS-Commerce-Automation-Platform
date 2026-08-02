import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { AIProcessingStage, AIDraftStatus, Prisma } from '@prisma/client';
import { ConfidenceScorerService } from './pipeline/confidence-scorer.service';

export interface StageHealth {
  stage: AIProcessingStage;
  runs: number;
  succeeded: number;
  failed: number;
  successRate: number;
  avgMs: number;
  p95Ms: number;
}

export interface AiMetrics {
  period: { days: number; from: string; to: string };
  pipeline: {
    totalRuns: number;
    succeeded: number;
    failed: number;
    successRate: number;
    byStage: StageHealth[];
  };
  /** Confidence bands come straight from BUSINESS_RULES §10. */
  confidence: {
    average: number | null;
    scored: number;
    bands: { label: string; range: string; count: number; share: number }[];
  };
  /**
   * The closest thing to real extraction accuracy this system can measure.
   * See `correctionRate` below.
   */
  accuracy: {
    drafts: number;
    corrected: number;
    correctionRate: number | null;
    approved: number;
    rejected: number;
    pending: number;
  };
  /** Surfaces whether the pipeline is running on real Gemini or the mock. */
  models: { modelUsed: string; runs: number }[];
  tokens: { total: number };
  recentFailures: {
    stage: AIProcessingStage;
    errorMessage: string | null;
    at: string;
  }[];
}

/**
 * AiMetricsService
 *
 * A read model over data the pipeline already writes.
 *
 * Every AI stage logs to AIProcessingLog — inputs, outputs, latency, token
 * count, confidence sub-scores and success — and until now nothing ever read
 * it. Questions as basic as "how many extractions failed yesterday?" or "are
 * we actually running on Gemini or still on the mock?" had no answer, which
 * is how a broken deploy pipeline went unnoticed for 26 days.
 *
 * Writes nothing. Every query is tenant-scoped and time-bounded.
 */
@Injectable()
export class AiMetricsService {
  private readonly logger = new Logger(AiMetricsService.name);

  /** Guards against an unbounded scan from a hand-edited query string. */
  private static readonly MAX_DAYS = 90;
  private static readonly RECENT_FAILURE_LIMIT = 10;

  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(tenantId: string, days = 7): Promise<AiMetrics> {
    const windowDays = Math.min(
      Math.max(Math.trunc(days) || 1, 1),
      AiMetricsService.MAX_DAYS,
    );

    const to = new Date();
    const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const [pipeline, confidence, accuracy, models, tokens, recentFailures] =
      await Promise.all([
        this.pipelineHealth(tenantId, from),
        this.confidenceDistribution(tenantId, from),
        this.extractionAccuracy(tenantId, from),
        this.modelMix(tenantId, from),
        this.tokenUsage(tenantId, from),
        this.recentFailures(tenantId, from),
      ]);

    return {
      period: {
        days: windowDays,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      pipeline,
      confidence,
      accuracy,
      models,
      tokens,
      recentFailures,
    };
  }

  // ── Pipeline health ────────────────────────────────────────────

  private async pipelineHealth(
    tenantId: string,
    from: Date,
  ): Promise<AiMetrics['pipeline']> {
    const grouped = await this.prisma.aIProcessingLog.groupBy({
      by: ['stage', 'success'],
      where: { tenantId, createdAt: { gte: from } },
      _count: { _all: true },
      _avg: { processingTimeMs: true },
    });

    const p95ByStage = await this.p95PerStage(tenantId, from);

    const stages = new Map<AIProcessingStage, StageHealth>();

    for (const row of grouped) {
      const existing = stages.get(row.stage) ?? {
        stage: row.stage,
        runs: 0,
        succeeded: 0,
        failed: 0,
        successRate: 0,
        avgMs: 0,
        p95Ms: p95ByStage.get(row.stage) ?? 0,
      };

      const count = row._count._all;
      existing.runs += count;
      if (row.success) {
        existing.succeeded += count;
      } else {
        existing.failed += count;
      }

      // Weighted mean across the success/failure split of the same stage.
      const avg = row._avg.processingTimeMs ?? 0;
      existing.avgMs =
        existing.runs === count
          ? avg
          : (existing.avgMs * (existing.runs - count) + avg * count) /
            existing.runs;

      stages.set(row.stage, existing);
    }

    const byStage = [...stages.values()].map((s) => ({
      ...s,
      avgMs: Math.round(s.avgMs),
      successRate: s.runs > 0 ? s.succeeded / s.runs : 0,
    }));

    const totalRuns = byStage.reduce((sum, s) => sum + s.runs, 0);
    const succeeded = byStage.reduce((sum, s) => sum + s.succeeded, 0);

    return {
      totalRuns,
      succeeded,
      failed: totalRuns - succeeded,
      successRate: totalRuns > 0 ? succeeded / totalRuns : 0,
      byStage,
    };
  }

  /**
   * p95 latency per stage.
   *
   * Raw SQL because Prisma has no percentile aggregate. Averages hide the
   * tail, and the tail is what customers actually feel on a slow AI call.
   *
   * Identifiers are quoted camelCase — @@map renames only the table. Getting
   * this wrong is not a loud failure: it throws at runtime and, if a caller
   * swallows it, degrades silently. That exact mistake left vector search
   * dead in this codebase, so it is worth being explicit about.
   */
  private async p95PerStage(
    tenantId: string,
    from: Date,
  ): Promise<Map<AIProcessingStage, number>> {
    try {
      const rows = await this.prisma.$queryRaw<
        { stage: AIProcessingStage; p95: number | null }[]
      >`
        SELECT
          stage,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY "processingTimeMs"
          ) AS p95
        FROM ai_processing_logs
        WHERE "tenantId" = ${tenantId}::uuid
          AND "createdAt" >= ${from}
        GROUP BY stage
      `;

      return new Map(
        rows.map((r) => [r.stage, Math.round(Number(r.p95 ?? 0))]),
      );
    } catch (error) {
      // A missing percentile must not take the whole dashboard down.
      this.logger.error(`Failed to compute p95 latency: ${String(error)}`);
      return new Map();
    }
  }

  // ── Confidence distribution (BUSINESS_RULES §10) ───────────────

  private async confidenceDistribution(
    tenantId: string,
    from: Date,
  ): Promise<AiMetrics['confidence']> {
    const scores = await this.prisma.aIProcessingLog.findMany({
      where: {
        tenantId,
        createdAt: { gte: from },
        stage: AIProcessingStage.CONFIDENCE_SCORING,
        overallConfidence: { not: null },
      },
      select: { overallConfidence: true },
    });

    const values = scores
      .map((s) => s.overallConfidence)
      .filter((v): v is number => v !== null);

    const below = values.filter(
      (v) => v < ConfidenceScorerService.HUMAN_REVIEW_FLOOR,
    ).length;
    const review = values.filter(
      (v) =>
        v >= ConfidenceScorerService.HUMAN_REVIEW_FLOOR &&
        v < ConfidenceScorerService.AUTO_APPROVE_FLOOR,
    ).length;
    const auto = values.filter(
      (v) => v >= ConfidenceScorerService.AUTO_APPROVE_FLOOR,
    ).length;

    const total = values.length;
    const share = (n: number) => (total > 0 ? n / total : 0);

    return {
      scored: total,
      average: total > 0 ? values.reduce((a, b) => a + b, 0) / total : null,
      bands: [
        {
          label: 'Manual confirmation required',
          range: `< ${ConfidenceScorerService.HUMAN_REVIEW_FLOOR}`,
          count: below,
          share: share(below),
        },
        {
          label: 'Owner review',
          range: `${ConfidenceScorerService.HUMAN_REVIEW_FLOOR} – ${ConfidenceScorerService.AUTO_APPROVE_FLOOR}`,
          count: review,
          share: share(review),
        },
        {
          label: 'Auto-approve eligible',
          range: `>= ${ConfidenceScorerService.AUTO_APPROVE_FLOOR}`,
          count: auto,
          share: share(auto),
        },
      ],
    };
  }

  // ── Extraction accuracy ────────────────────────────────────────

  /**
   * `correctionRate` is the headline number.
   *
   * There is no ground truth for "did the AI read the customer correctly",
   * but there is something better than a guess: whether the OWNER had to edit
   * the draft before approving it. A draft with `humanCorrections` set is one
   * the AI got wrong in a way a human noticed and fixed.
   *
   * So correctionRate is a lower bound on the error rate, and (1 - it) is a
   * practical proxy for the PRD's 95% extraction-accuracy target. It is also
   * the only accuracy signal that comes from real customers rather than a
   * curated test set.
   */
  private async extractionAccuracy(
    tenantId: string,
    from: Date,
  ): Promise<AiMetrics['accuracy']> {
    const where = { tenantId, createdAt: { gte: from }, deletedAt: null };

    const [drafts, corrected, byStatus] = await Promise.all([
      this.prisma.aIDraftOrder.count({ where }),
      this.prisma.aIDraftOrder.count({
        where: { ...where, humanCorrections: { not: Prisma.DbNull } },
      }),
      this.prisma.aIDraftOrder.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    const countFor = (status: AIDraftStatus) =>
      byStatus.find((s) => s.status === status)?._count._all ?? 0;

    return {
      drafts,
      corrected,
      correctionRate: drafts > 0 ? corrected / drafts : null,
      approved: countFor(AIDraftStatus.APPROVED),
      rejected: countFor(AIDraftStatus.REJECTED),
      pending: countFor(AIDraftStatus.PENDING),
    };
  }

  // ── Model mix, tokens, failures ────────────────────────────────

  private async modelMix(
    tenantId: string,
    from: Date,
  ): Promise<AiMetrics['models']> {
    const grouped = await this.prisma.aIProcessingLog.groupBy({
      by: ['modelUsed'],
      where: { tenantId, createdAt: { gte: from } },
      _count: { _all: true },
    });

    return grouped
      .map((g) => ({ modelUsed: g.modelUsed, runs: g._count._all }))
      .sort((a, b) => b.runs - a.runs);
  }

  private async tokenUsage(
    tenantId: string,
    from: Date,
  ): Promise<AiMetrics['tokens']> {
    const result = await this.prisma.aIProcessingLog.aggregate({
      where: { tenantId, createdAt: { gte: from } },
      _sum: { tokenCount: true },
    });

    return { total: result._sum.tokenCount ?? 0 };
  }

  private async recentFailures(
    tenantId: string,
    from: Date,
  ): Promise<AiMetrics['recentFailures']> {
    const rows = await this.prisma.aIProcessingLog.findMany({
      where: { tenantId, createdAt: { gte: from }, success: false },
      select: { stage: true, errorMessage: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: AiMetricsService.RECENT_FAILURE_LIMIT,
    });

    return rows.map((r) => ({
      stage: r.stage,
      errorMessage: r.errorMessage,
      at: r.createdAt.toISOString(),
    }));
  }
}
