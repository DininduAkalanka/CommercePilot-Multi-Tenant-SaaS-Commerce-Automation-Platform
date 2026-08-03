import { Test, TestingModule } from '@nestjs/testing';
import { AiMetricsService } from './ai-metrics.service';
import { PrismaService } from '../../common/database/prisma.service';
import { AIProcessingStage, AIDraftStatus } from '@prisma/client';

describe('AiMetricsService', () => {
  let service: AiMetricsService;

  const mockPrisma = {
    aIProcessingLog: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    aIDraftOrder: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  /** Sensible empty defaults; individual tests override what they care about. */
  const resetToEmpty = () => {
    mockPrisma.aIProcessingLog.groupBy.mockResolvedValue([]);
    mockPrisma.aIProcessingLog.findMany.mockResolvedValue([]);
    mockPrisma.aIProcessingLog.aggregate.mockResolvedValue({
      _sum: { tokenCount: null },
    });
    mockPrisma.aIDraftOrder.count.mockResolvedValue(0);
    mockPrisma.aIDraftOrder.groupBy.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiMetricsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AiMetricsService>(AiMetricsService);
    resetToEmpty();
  });

  afterEach(() => jest.clearAllMocks());

  describe('window handling', () => {
    it('defaults to 7 days', async () => {
      const result = await service.getMetrics('tenant-1');
      expect(result.period.days).toBe(7);
    });

    it('clamps an absurd window rather than scanning everything', async () => {
      const result = await service.getMetrics('tenant-1', 99999);
      expect(result.period.days).toBe(90);
    });

    it('clamps zero and negative windows to 1 day', async () => {
      expect((await service.getMetrics('tenant-1', 0)).period.days).toBe(1);
      expect((await service.getMetrics('tenant-1', -5)).period.days).toBe(1);
    });

    it('survives a non-numeric window', async () => {
      const result = await service.getMetrics('tenant-1', NaN);
      expect(result.period.days).toBe(1);
    });
  });

  describe('empty tenant', () => {
    it('returns zeroed metrics without dividing by zero', async () => {
      const result = await service.getMetrics('tenant-1');

      expect(result.pipeline.totalRuns).toBe(0);
      expect(result.pipeline.successRate).toBe(0);
      expect(result.confidence.average).toBeNull();
      expect(result.accuracy.correctionRate).toBeNull();
      expect(result.tokens.total).toBe(0);
      expect(Number.isNaN(result.pipeline.successRate)).toBe(false);
    });
  });

  describe('pipeline health', () => {
    it('splits successes and failures per stage and computes a success rate', async () => {
      mockPrisma.aIProcessingLog.groupBy.mockImplementation(
        ({ by }: { by: string[] }) => {
          if (by.includes('stage') && by.includes('success')) {
            return Promise.resolve([
              {
                stage: AIProcessingStage.ENTITY_EXTRACTION,
                success: true,
                _count: { _all: 8 },
                _avg: { processingTimeMs: 100 },
              },
              {
                stage: AIProcessingStage.ENTITY_EXTRACTION,
                success: false,
                _count: { _all: 2 },
                _avg: { processingTimeMs: 300 },
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );
      mockPrisma.$queryRaw.mockResolvedValue([
        { stage: AIProcessingStage.ENTITY_EXTRACTION, p95: 280 },
      ]);

      const result = await service.getMetrics('tenant-1');
      const stage = result.pipeline.byStage[0];

      expect(stage.runs).toBe(10);
      expect(stage.succeeded).toBe(8);
      expect(stage.failed).toBe(2);
      expect(stage.successRate).toBeCloseTo(0.8, 5);
      // Weighted mean of 100 (x8) and 300 (x2) = 140.
      expect(stage.avgMs).toBe(140);
      expect(stage.p95Ms).toBe(280);

      expect(result.pipeline.totalRuns).toBe(10);
      expect(result.pipeline.failed).toBe(2);
      expect(result.pipeline.successRate).toBeCloseTo(0.8, 5);
    });

    it('still returns metrics when the p95 query fails', async () => {
      mockPrisma.aIProcessingLog.groupBy.mockResolvedValue([
        {
          stage: AIProcessingStage.INTENT_DETECTION,
          success: true,
          _count: { _all: 3 },
          _avg: { processingTimeMs: 50 },
        },
      ]);
      mockPrisma.$queryRaw.mockRejectedValue(new Error('percentile exploded'));

      const result = await service.getMetrics('tenant-1');

      // Degrades to 0 rather than taking the whole dashboard down.
      expect(result.pipeline.byStage[0].p95Ms).toBe(0);
      expect(result.pipeline.byStage[0].runs).toBe(3);
    });
  });

  describe('confidence bands follow BUSINESS_RULES §10', () => {
    it('buckets scores at the 0.80 and 0.95 boundaries', async () => {
      mockPrisma.aIProcessingLog.findMany.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) => {
          if (where.stage === AIProcessingStage.CONFIDENCE_SCORING) {
            return Promise.resolve([
              { overallConfidence: 0.5 }, // below
              { overallConfidence: 0.79 }, // below
              { overallConfidence: 0.8 }, // review (inclusive)
              { overallConfidence: 0.94 }, // review
              { overallConfidence: 0.95 }, // auto (inclusive)
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const result = await service.getMetrics('tenant-1');
      const [below, review, auto] = result.confidence.bands;

      expect(below.count).toBe(2);
      expect(review.count).toBe(2);
      expect(auto.count).toBe(1);
      expect(result.confidence.scored).toBe(5);
      expect(result.confidence.average).toBeCloseTo(0.796, 3);
      expect(below.share).toBeCloseTo(0.4, 5);
    });
  });

  describe('extraction accuracy', () => {
    it('reports the owner correction rate', async () => {
      mockPrisma.aIDraftOrder.count
        .mockResolvedValueOnce(20) // drafts
        .mockResolvedValueOnce(5); // corrected
      mockPrisma.aIDraftOrder.groupBy.mockResolvedValue([
        { status: AIDraftStatus.APPROVED, _count: { _all: 12 } },
        { status: AIDraftStatus.REJECTED, _count: { _all: 3 } },
        { status: AIDraftStatus.PENDING, _count: { _all: 5 } },
      ]);

      const result = await service.getMetrics('tenant-1');

      expect(result.accuracy.drafts).toBe(20);
      expect(result.accuracy.corrected).toBe(5);
      expect(result.accuracy.correctionRate).toBeCloseTo(0.25, 5);
      expect(result.accuracy.approved).toBe(12);
      expect(result.accuracy.rejected).toBe(3);
      expect(result.accuracy.pending).toBe(5);
    });
  });

  describe('model mix', () => {
    it('surfaces whether the pipeline ran on mock or real Gemini', async () => {
      mockPrisma.aIProcessingLog.groupBy.mockImplementation(
        ({ by }: { by: string[] }) => {
          if (by.includes('modelUsed')) {
            return Promise.resolve([
              { modelUsed: 'mock-gemini-v2', _count: { _all: 40 } },
              { modelUsed: 'gemini-1.5-flash', _count: { _all: 60 } },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const result = await service.getMetrics('tenant-1');

      // Sorted by volume so the dominant model is obvious at a glance.
      expect(result.models[0]).toEqual({
        modelUsed: 'gemini-1.5-flash',
        runs: 60,
      });
      expect(result.models[1].modelUsed).toBe('mock-gemini-v2');
    });
  });

  describe('tenant scoping', () => {
    it('scopes every query to the calling tenant', async () => {
      await service.getMetrics('tenant-abc');

      const scoped = [
        ...mockPrisma.aIProcessingLog.groupBy.mock.calls,
        ...mockPrisma.aIProcessingLog.findMany.mock.calls,
        ...mockPrisma.aIProcessingLog.aggregate.mock.calls,
        ...mockPrisma.aIDraftOrder.count.mock.calls,
        ...mockPrisma.aIDraftOrder.groupBy.mock.calls,
      ];

      expect(scoped.length).toBeGreaterThan(0);
      for (const [args] of scoped) {
        expect(args.where.tenantId).toBe('tenant-abc');
        expect(args.where.createdAt?.gte).toBeInstanceOf(Date);
      }
    });
  });

  describe('daily activity', () => {
    it('returns one entry per day in the window, including days with nothing', () => {
      // A trend line with gaps is unreadable — a quiet Sunday must render as
      // zero, not vanish and make Monday look adjacent to Saturday.
      const series = AiMetricsService.buildDailySeries(
        new Date('2026-08-01T00:00:00Z'),
        3,
        [
          { day: '2026-08-01', prepared: 4, corrected: 1 },
          { day: '2026-08-03', prepared: 2, corrected: 0 },
        ],
      );

      expect(series).toHaveLength(3);
      expect(series.map((d) => d.date)).toEqual([
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
      ]);
      expect(series[1]).toEqual({
        date: '2026-08-02',
        prepared: 0,
        corrected: 0,
      });
    });

    it('keeps the days in chronological order', () => {
      const series = AiMetricsService.buildDailySeries(
        new Date('2026-08-01T00:00:00Z'),
        3,
        [{ day: '2026-08-03', prepared: 1, corrected: 0 }],
      );

      const dates = series.map((d) => d.date);
      expect([...dates].sort()).toEqual(dates);
    });

    it('ignores rows outside the window rather than stretching the chart', () => {
      const series = AiMetricsService.buildDailySeries(
        new Date('2026-08-01T00:00:00Z'),
        2,
        [
          { day: '2026-07-20', prepared: 99, corrected: 99 },
          { day: '2026-08-02', prepared: 3, corrected: 1 },
        ],
      );

      expect(series).toHaveLength(2);
      expect(series.some((d) => d.prepared === 99)).toBe(false);
      expect(series[1].prepared).toBe(3);
    });
  });
});
