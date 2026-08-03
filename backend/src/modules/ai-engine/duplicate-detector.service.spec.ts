import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DuplicateDetectorService } from './duplicate-detector.service';
import { PrismaService } from '../../common/database/prisma.service';
import { AIDraftStatus } from '@prisma/client';

/**
 * BUSINESS_RULES §18.
 *
 * The scenario this exists for: a customer sends "2 shirts", gets no immediate
 * reply, and sends it again. Message-level dedup on externalMessageId does not
 * help — these are two genuinely different messages — so two drafts were
 * created and, on approval, two real WooCommerce orders.
 */
describe('DuplicateDetectorService', () => {
  let service: DuplicateDetectorService;

  const mockPrisma = { aIDraftOrder: { findMany: jest.fn() } };
  let config: Record<string, string>;
  const mockConfig = {
    get: jest.fn((key: string, def?: string) => config[key] ?? def),
  };

  beforeEach(async () => {
    config = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuplicateDetectorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<DuplicateDetectorService>(DuplicateDetectorService);
    mockPrisma.aIDraftOrder.findMany.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  describe('signature', () => {
    it('ignores line order — the same order written differently is one order', () => {
      const a = DuplicateDetectorService.signature([
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 1 },
      ]);
      const b = DuplicateDetectorService.signature([
        { productId: 'p2', quantity: 1 },
        { productId: 'p1', quantity: 2 },
      ]);

      expect(a).toBe(b);
    });

    it('separates different quantities of the same product', () => {
      expect(
        DuplicateDetectorService.signature([{ productId: 'p1', quantity: 2 }]),
      ).not.toBe(
        DuplicateDetectorService.signature([{ productId: 'p1', quantity: 3 }]),
      );
    });

    it('falls back to the customer wording when nothing matched', () => {
      // Unmatched repeats still need catching, and the query text is all
      // there is to compare.
      const a = DuplicateDetectorService.signature([
        { productId: null, productQuery: 'Red  Saree', quantity: 1 },
      ]);
      const b = DuplicateDetectorService.signature([
        { productId: null, productQuery: 'red saree', quantity: 1 },
      ]);

      expect(a).toBe(b);
    });

    it('returns null when there is nothing identifiable', () => {
      // A failed parse is not a duplicate of anything; treating it as one
      // would flag every unparseable message.
      expect(DuplicateDetectorService.signature([])).toBeNull();
      expect(
        DuplicateDetectorService.signature([{ productId: null, quantity: 1 }]),
      ).toBeNull();
    });
  });

  describe('findRecentDuplicate', () => {
    const items = [{ productId: 'p1', quantity: 2 }];

    it('flags a recent draft ordering exactly the same things', async () => {
      mockPrisma.aIDraftOrder.findMany.mockResolvedValue([
        { id: 'draft-earlier', items: [{ productId: 'p1', quantity: 2 }] },
      ]);

      expect(
        await service.findRecentDuplicate('tenant-1', 'cust-1', items),
      ).toBe('draft-earlier');
    });

    it('does not flag a different quantity', async () => {
      mockPrisma.aIDraftOrder.findMany.mockResolvedValue([
        { id: 'draft-earlier', items: [{ productId: 'p1', quantity: 5 }] },
      ]);

      expect(
        await service.findRecentDuplicate('tenant-1', 'cust-1', items),
      ).toBeNull();
    });

    it('only compares drafts that are still live', async () => {
      await service.findRecentDuplicate('tenant-1', 'cust-1', items);

      const where = mockPrisma.aIDraftOrder.findMany.mock.calls[0][0].where;
      // A rejected draft means the owner already said no — a new attempt is
      // not a duplicate to warn about.
      expect(where.status.in).toEqual([
        AIDraftStatus.PENDING,
        AIDraftStatus.REVIEWED,
        AIDraftStatus.APPROVED,
      ]);
      expect(where.tenantId).toBe('tenant-1');
      expect(where.customerId).toBe('cust-1');
      expect(where.deletedAt).toBeNull();
    });

    it('honours the configured window', async () => {
      config.DUPLICATE_WINDOW_MINUTES = '30';
      const before = Date.now();

      await service.findRecentDuplicate('tenant-1', 'cust-1', items);

      const since: Date =
        mockPrisma.aIDraftOrder.findMany.mock.calls[0][0].where.createdAt.gte;
      const minutesAgo = (before - since.getTime()) / 60000;
      expect(minutesAgo).toBeGreaterThan(29);
      expect(minutesAgo).toBeLessThan(31);
    });

    it('falls back to the default window when misconfigured', async () => {
      config.DUPLICATE_WINDOW_MINUTES = 'not-a-number';
      const before = Date.now();

      await service.findRecentDuplicate('tenant-1', 'cust-1', items);

      const since: Date =
        mockPrisma.aIDraftOrder.findMany.mock.calls[0][0].where.createdAt.gte;
      const minutesAgo = (before - since.getTime()) / 60000;
      expect(minutesAgo).toBeGreaterThan(9);
      expect(minutesAgo).toBeLessThan(11);
    });

    it('can be switched off entirely without a deploy', async () => {
      config.DUPLICATE_DETECTION_ENABLED = 'false';

      expect(
        await service.findRecentDuplicate('tenant-1', 'cust-1', items),
      ).toBeNull();
      expect(mockPrisma.aIDraftOrder.findMany).not.toHaveBeenCalled();
    });

    it('skips the query when there is nothing to compare', async () => {
      expect(
        await service.findRecentDuplicate('tenant-1', 'cust-1', []),
      ).toBeNull();
      expect(mockPrisma.aIDraftOrder.findMany).not.toHaveBeenCalled();
    });

    it('never throws — a detection failure must not stop the draft', async () => {
      mockPrisma.aIDraftOrder.findMany.mockRejectedValue(
        new Error('database on fire'),
      );

      expect(
        await service.findRecentDuplicate('tenant-1', 'cust-1', items),
      ).toBeNull();
    });
  });
});
