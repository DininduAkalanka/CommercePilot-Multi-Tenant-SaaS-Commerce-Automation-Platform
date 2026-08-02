import { Test, TestingModule } from '@nestjs/testing';
import { ConfidenceScorerService } from './confidence-scorer.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { ExtractedOrder } from './entity-extractor.service';

/**
 * These tests pin BUSINESS_RULES.md §10 — the routing bands.
 *
 * Regression: routing used a bare 0.6 cutoff, so orders scoring 0.60–0.79
 * went to ordinary owner review even though §10 requires manual confirmation
 * below 0.80. The business-rules document explicitly takes precedence over
 * conflicting implementation, so this was a compliance defect, not a tuning
 * preference.
 */
describe('ConfidenceScorerService — BUSINESS_RULES §10 routing', () => {
  let service: ConfidenceScorerService;

  const mockPrisma = {
    order: { count: jest.fn() },
    aIProcessingLog: { create: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfidenceScorerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ConfidenceScorerService>(ConfidenceScorerService);
    mockPrisma.aIProcessingLog.create.mockResolvedValue({});
    mockPrisma.order.count.mockResolvedValue(0); // no repeat-customer bonus
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Build an extraction whose composite score lands on `target`.
   *
   * composite = intent*0.25 + productMatch*0.40 + completeness*0.25 + history
   * With completeness = 1.0 (no missing fields) and history = 0, setting
   * intent and productMatch to the same value v gives:
   *   composite = 0.65v + 0.25
   */
  const orderWith = (matchConfidence: number): ExtractedOrder => ({
    items: [
      {
        product_query: 'mouse',
        matched_product_id: '11111111-1111-4111-8111-111111111111',
        matched_product_name: 'Wireless Mouse',
        match_confidence: matchConfidence,
        quantity: 1,
        selected_attributes: { size: null, color: null },
      },
    ],
    delivery_info: { address: 'X', requested_date: null, notes: null },
    missing_fields: [],
    customer_notes: null,
  });

  /** Solve 0.65v + 0.25 = target for v. */
  const vFor = (target: number) => (target - 0.25) / 0.65;

  const run = (
    target: number,
    autoApproveEnabled = false,
    tenantThreshold = 0.95,
  ) => {
    const v = vFor(target);
    return service.score(
      'tenant-1',
      'customer-1',
      'msg-1',
      v,
      orderWith(v),
      autoApproveEnabled,
      tenantThreshold,
    );
  };

  describe('below 0.80 — manual confirmation required', () => {
    it('routes 0.60 to gather_more_info (was human_review under the old 0.6 cutoff)', async () => {
      const result = await run(0.6);

      expect(result.composite).toBeCloseTo(0.6, 5);
      expect(result.routing).toBe('gather_more_info');
    });

    it('routes 0.79 to gather_more_info — just under the review floor', async () => {
      const result = await run(0.79);

      expect(result.routing).toBe('gather_more_info');
    });
  });

  describe('0.80 – 0.94 — owner review', () => {
    it('routes exactly 0.80 to human_review (inclusive boundary)', async () => {
      const result = await run(0.8);

      expect(result.composite).toBeCloseTo(0.8, 5);
      expect(result.routing).toBe('human_review');
    });

    it('routes 0.94 to human_review, not auto_approve', async () => {
      const result = await run(0.94, true);

      expect(result.routing).toBe('human_review');
    });
  });

  describe('>= 0.95 — automatic draft creation', () => {
    it('routes 0.96 to auto_approve when the tenant enables it', async () => {
      const result = await run(0.96, true);

      expect(result.routing).toBe('auto_approve');
    });

    it('still requires human review when the tenant has auto-approve disabled', async () => {
      const result = await run(0.96, false);

      expect(result.routing).toBe('human_review');
    });
  });

  describe('tenant threshold may tighten §10 but never loosen it', () => {
    it('ignores a tenant threshold below the §10 auto-approve floor', async () => {
      // A tenant setting 0.5 would otherwise auto-approve an order that §10
      // says a human must confirm.
      const result = await run(0.85, true, 0.5);

      expect(result.routing).toBe('human_review');
    });

    it('honours a stricter tenant threshold', async () => {
      // 0.96 clears §10's floor but not this tenant's stricter 0.99.
      const result = await run(0.96, true, 0.99);

      expect(result.routing).toBe('human_review');
    });
  });

  describe('missing fields always win', () => {
    it('gathers more info even at a high score when a field is missing', async () => {
      const extraction = orderWith(1.0);
      extraction.missing_fields = ['quantity'];

      const result = await service.score(
        'tenant-1',
        'customer-1',
        'msg-1',
        1.0,
        extraction,
        true,
        0.95,
      );

      expect(result.routing).toBe('gather_more_info');
    });
  });
});
