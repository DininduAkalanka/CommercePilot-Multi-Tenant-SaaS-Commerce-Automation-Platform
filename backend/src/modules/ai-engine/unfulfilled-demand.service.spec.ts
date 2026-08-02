import { Test, TestingModule } from '@nestjs/testing';
import { UnfulfilledDemandService } from './unfulfilled-demand.service';
import { PrismaService } from '../../common/database/prisma.service';
import { UnfulfilledReason } from '@prisma/client';

describe('UnfulfilledDemandService', () => {
  let service: UnfulfilledDemandService;

  const mockPrisma = {
    unfulfilledDemand: {
      create: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnfulfilledDemandService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UnfulfilledDemandService>(UnfulfilledDemandService);
    mockPrisma.unfulfilledDemand.create.mockResolvedValue({});
    mockPrisma.unfulfilledDemand.groupBy.mockResolvedValue([]);
    mockPrisma.unfulfilledDemand.findMany.mockResolvedValue([]);
    mockPrisma.unfulfilledDemand.count.mockResolvedValue(0);
  });

  afterEach(() => jest.clearAllMocks());

  describe('normalize', () => {
    it('collapses casing and whitespace so phrasings aggregate', () => {
      // These are one product to the owner reading the report, so they must be
      // one row in it.
      expect(UnfulfilledDemandService.normalize('  Red   SAREE ')).toBe(
        'red saree',
      );
      expect(UnfulfilledDemandService.normalize('red saree')).toBe('red saree');
    });
  });

  describe('record', () => {
    it('stores the original wording and a normalised form', async () => {
      await service.record({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        messageId: 'msg-1',
        query: '  Red  Saree ',
        reason: UnfulfilledReason.NO_CATALOG_MATCH,
      });

      expect(mockPrisma.unfulfilledDemand.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          customerId: 'cust-1',
          query: 'Red  Saree', // trimmed, casing preserved for the owner
          normalizedQuery: 'red saree', // collapsed, for grouping
          reason: UnfulfilledReason.NO_CATALOG_MATCH,
        }),
      });
    });

    it.each([
      ['empty', ''],
      ['whitespace', '   '],
      ['one character', 'x'],
    ])('ignores a %s query as extractor noise', async (_label, query) => {
      await service.record({
        tenantId: 'tenant-1',
        query,
        reason: UnfulfilledReason.NO_CATALOG_MATCH,
      });

      expect(mockPrisma.unfulfilledDemand.create).not.toHaveBeenCalled();
    });

    it('never throws — a failed statistic must not cost a customer their reply', async () => {
      mockPrisma.unfulfilledDemand.create.mockRejectedValue(
        new Error('database on fire'),
      );

      await expect(
        service.record({
          tenantId: 'tenant-1',
          query: 'red saree',
          reason: UnfulfilledReason.NO_CATALOG_MATCH,
        }),
      ).resolves.toBeUndefined();
    });

    it('truncates an absurdly long query', async () => {
      await service.record({
        tenantId: 'tenant-1',
        query: 'x'.repeat(500),
        reason: UnfulfilledReason.NO_CATALOG_MATCH,
      });

      const data = mockPrisma.unfulfilledDemand.create.mock.calls[0][0].data;
      expect(data.query).toHaveLength(120);
      expect(data.normalizedQuery).toHaveLength(120);
    });
  });

  describe('getSummary', () => {
    it('ranks by distinct customers, not raw request count', async () => {
      mockPrisma.unfulfilledDemand.groupBy.mockImplementation(
        ({ by }: { by: string[] }) => {
          if (by.length === 2) {
            return Promise.resolve([
              {
                normalizedQuery: 'red saree',
                reason: UnfulfilledReason.NO_CATALOG_MATCH,
                _count: { _all: 5 },
                _min: { createdAt: new Date('2026-08-01'), query: 'Red Saree' },
                _max: { createdAt: new Date('2026-08-03') },
              },
              {
                normalizedQuery: 'blue frock',
                reason: UnfulfilledReason.NO_CATALOG_MATCH,
                _count: { _all: 3 },
                _min: {
                  createdAt: new Date('2026-08-02'),
                  query: 'blue frock',
                },
                _max: { createdAt: new Date('2026-08-03') },
              },
            ]);
          }
          return Promise.resolve([{ normalizedQuery: 'red saree' }]);
        },
      );

      // "red saree" was asked 5 times but by one persistent person;
      // "blue frock" 3 times by 3 different people — the better stocking signal.
      mockPrisma.unfulfilledDemand.findMany.mockResolvedValue([
        { normalizedQuery: 'red saree', customerId: 'c1' },
        { normalizedQuery: 'red saree', customerId: 'c1' },
        { normalizedQuery: 'red saree', customerId: 'c1' },
        { normalizedQuery: 'red saree', customerId: 'c1' },
        { normalizedQuery: 'red saree', customerId: 'c1' },
        { normalizedQuery: 'blue frock', customerId: 'c2' },
        { normalizedQuery: 'blue frock', customerId: 'c3' },
        { normalizedQuery: 'blue frock', customerId: 'c4' },
      ]);
      mockPrisma.unfulfilledDemand.count.mockResolvedValue(8);

      const summary = await service.getSummary('tenant-1', 30);

      expect(summary.top[0].query).toBe('blue frock');
      expect(summary.top[0].customers).toBe(3);
      expect(summary.top[1].query).toBe('Red Saree');
      expect(summary.top[1].customers).toBe(1);
      expect(summary.top[1].requests).toBe(5);
      expect(summary.totalRequests).toBe(8);
    });

    it('clamps an absurd window rather than scanning everything', async () => {
      expect((await service.getSummary('t', 99999)).period.days).toBe(365);
      expect((await service.getSummary('t', 0)).period.days).toBe(1);
      expect((await service.getSummary('t', NaN)).period.days).toBe(1);
    });

    it('returns an empty summary for a tenant with no misses', async () => {
      const summary = await service.getSummary('tenant-1');

      expect(summary.top).toEqual([]);
      expect(summary.totalRequests).toBe(0);
      expect(summary.distinctQueries).toBe(0);
    });

    it('scopes every query to the calling tenant', async () => {
      await service.getSummary('tenant-xyz');

      for (const [args] of mockPrisma.unfulfilledDemand.groupBy.mock.calls) {
        expect(args.where.tenantId).toBe('tenant-xyz');
      }
      for (const [args] of mockPrisma.unfulfilledDemand.count.mock.calls) {
        expect(args.where.tenantId).toBe('tenant-xyz');
      }
    });
  });
});
