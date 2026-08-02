import { AuditLogsService } from './audit-logs.service';
import { PrismaService } from '../../common/database/prisma.service';

describe('AuditLogsService', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const prisma = {
    auditLog: { findMany, count },
  } as unknown as PrismaService;

  let service: AuditLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogsService(prisma);
  });

  describe('findAll', () => {
    it('scopes every query to the tenant and returns pagination meta', async () => {
      findMany.mockResolvedValue([{ id: 'a1' }]);
      count.mockResolvedValue(41);

      const result = await service.findAll('tenant-1', { page: 2, limit: 20 });

      const args = findMany.mock.calls[0][0];
      expect(args.where.tenantId).toBe('tenant-1');
      expect(args.skip).toBe(20); // (2-1)*20
      expect(args.take).toBe(20);
      expect(args.orderBy).toEqual({ timestamp: 'desc' });

      expect(result.meta).toEqual({
        page: 2,
        limit: 20,
        total: 41,
        totalPages: 3,
      });
    });

    it('applies optional filters when provided', async () => {
      findMany.mockResolvedValue([]);
      count.mockResolvedValue(0);

      await service.findAll('tenant-1', {
        page: 1,
        limit: 20,
        entityType: 'Order',
        entityId: 'order-9',
        action: 'ORDER_APPROVED',
        actorUserId: 'user-3',
      });

      expect(findMany.mock.calls[0][0].where).toEqual({
        tenantId: 'tenant-1',
        entityType: 'Order',
        entityId: 'order-9',
        action: 'ORDER_APPROVED',
        actorUserId: 'user-3',
      });
    });

    it('omits filter keys that are not supplied', async () => {
      findMany.mockResolvedValue([]);
      count.mockResolvedValue(0);

      await service.findAll('tenant-1', { page: 1, limit: 20 });

      expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-1' });
    });
  });

  describe('findForEntity', () => {
    it('queries a single entity within the tenant boundary, newest-first', async () => {
      findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

      await service.findForEntity('tenant-1', 'Order', 'order-9');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            entityType: 'Order',
            entityId: 'order-9',
          },
          orderBy: { timestamp: 'desc' },
        }),
      );
    });
  });
});
