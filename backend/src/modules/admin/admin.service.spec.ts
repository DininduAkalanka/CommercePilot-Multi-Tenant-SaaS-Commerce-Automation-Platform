import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

describe('AdminService', () => {
  const tenant = { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const user = { count: jest.fn() };
  const order = { count: jest.fn() };
  const product = { count: jest.fn() };
  const prisma = { tenant, user, order, product } as unknown as PrismaService;
  const auditLog = { create: jest.fn() } as unknown as AuditLogService;

  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(prisma, auditLog);
  });

  describe('listTenants', () => {
    it('never selects tenant credentials', async () => {
      tenant.findMany.mockResolvedValue([]);
      tenant.count.mockResolvedValue(0);

      await service.listTenants(1, 20);

      const select = tenant.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('woocommerceKey');
      expect(select).not.toHaveProperty('woocommerceSecret');
      expect(select).not.toHaveProperty('whatsappAccessToken');
    });

    it('returns pagination meta', async () => {
      tenant.findMany.mockResolvedValue([{ id: 't1' }]);
      tenant.count.mockResolvedValue(21);

      const res = await service.listTenants(1, 20);
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 21, totalPages: 2 });
    });
  });

  describe('setTenantStatus', () => {
    it('throws NotFound for an unknown tenant', async () => {
      tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.setTenantStatus('admin-1', 'ghost', false),
      ).rejects.toThrow(NotFoundException);
    });

    it('suspends a tenant and writes a TENANT_SUSPENDED audit entry', async () => {
      tenant.findUnique.mockResolvedValue({ id: 't1', isActive: true, name: 'Store' });
      tenant.update.mockResolvedValue({ id: 't1', isActive: false });

      await service.setTenantStatus('admin-1', 't1', false);

      expect(tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' }, data: { isActive: false } }),
      );
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TENANT_SUSPENDED',
          entityType: 'Tenant',
          entityId: 't1',
        }),
      );
    });
  });

  describe('platformStats', () => {
    it('aggregates platform-wide counts', async () => {
      tenant.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
      user.count.mockResolvedValue(25);
      order.count.mockResolvedValue(100);
      product.count.mockResolvedValue(50);

      const res = await service.platformStats();
      expect(res).toEqual({
        tenants: 10,
        activeTenants: 8,
        users: 25,
        orders: 100,
        products: 50,
      });
    });
  });
});
