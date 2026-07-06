import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../common/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AIDraftStatus, OrderStatus } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;

  const mockPrisma = {
    aIDraftOrder: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    aIDraftOrderItem: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    customer: {
      update: jest.fn(),
    },
    inventoryTransaction: {
      create: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    aIProcessingLog: {
      findMany: jest.fn(),
    },
    whatsAppMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPendingDrafts', () => {
    it('should return pending drafts for a tenant', async () => {
      const tenantId = 'tenant-1';
      const mockDrafts = [
        { id: 'draft-1', tenantId, status: AIDraftStatus.PENDING },
        { id: 'draft-2', tenantId, status: AIDraftStatus.PENDING },
      ];
      mockPrisma.aIDraftOrder.findMany.mockResolvedValue(mockDrafts);

      const result = await service.getPendingDrafts(tenantId);

      expect(result).toEqual(mockDrafts);
      expect(mockPrisma.aIDraftOrder.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          status: AIDraftStatus.PENDING,
          deletedAt: null,
        },
        include: {
          customer: true,
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getDraftById', () => {
    it('should return a draft with AI logs', async () => {
      const tenantId = 'tenant-1';
      const draftId = 'draft-1';
      const mockDraft = {
        id: draftId,
        tenantId,
        messageId: 'msg-1',
        customer: { id: 'cust-1' },
        items: [],
      };

      mockPrisma.aIDraftOrder.findFirst.mockResolvedValue(mockDraft);
      mockPrisma.aIProcessingLog.findMany.mockResolvedValue([]);
      mockPrisma.whatsAppMessage.findUnique.mockResolvedValue(null);

      const result = await service.getDraftById(tenantId, draftId);

      expect(result.draft).toEqual(mockDraft);
      expect(result.aiLogs).toEqual([]);
    });

    it('should throw NotFoundException for missing draft', async () => {
      mockPrisma.aIDraftOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.getDraftById('tenant-1', 'nonexistent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rejectDraft', () => {
    it('should reject a pending draft and emit order.rejected event', async () => {
      const tenantId = 'tenant-1';
      const draftId = 'draft-1';
      const userId = 'user-1';
      const reason = 'Out of scope';

      mockPrisma.aIDraftOrder.findFirst.mockResolvedValue({
        id: draftId,
        tenantId,
        status: AIDraftStatus.PENDING,
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));

      const result = await service.rejectDraft(tenantId, draftId, userId, reason);

      expect(result).toEqual({ success: true, message: 'Order rejected' });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('order.rejected', {
        tenantId,
        draftId,
        reason,
      });
    });

    it('should throw NotFoundException for non-existent draft', async () => {
      mockPrisma.aIDraftOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.rejectDraft('tenant-1', 'missing', 'user-1', 'no reason'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOrders', () => {
    it('should return paginated orders', async () => {
      const tenantId = 'tenant-1';
      const mockOrders = [{ id: 'order-1' }];
      mockPrisma.order.findMany.mockResolvedValue(mockOrders);
      mockPrisma.order.count.mockResolvedValue(1);

      const result = await service.getOrders(tenantId, {
        page: 1,
        limit: 20,
      });

      expect(result.orders).toEqual(mockOrders);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('getDashboardStats', () => {
    it('should return dashboard KPI stats', async () => {
      mockPrisma.order.count
        .mockResolvedValueOnce(10) // totalOrders
        .mockResolvedValueOnce(3); // approvedToday

      mockPrisma.aIDraftOrder.findMany = jest.fn(); // not used directly
      // Mock for pendingApproval
      (mockPrisma.aIDraftOrder as any).count = jest.fn()
        .mockResolvedValueOnce(2) // pendingApproval
        .mockResolvedValueOnce(1); // rejectedToday

      const stats = await service.getDashboardStats('tenant-1');

      expect(stats).toHaveProperty('totalOrders');
      expect(stats).toHaveProperty('pendingApproval');
      expect(stats).toHaveProperty('approvedToday');
      expect(stats).toHaveProperty('rejectedToday');
    });
  });

  describe('getRecentActivity', () => {
    it('should return formatted recent activity logs', async () => {
      const mockLogs = [
        { id: 'log-1', action: 'ORDER_APPROVED', entityId: 'order-1', timestamp: new Date() },
        { id: 'log-2', action: 'ORDER_REJECTED', entityId: 'draft-1', timestamp: new Date() },
      ];
      mockPrisma.auditLog.findMany.mockResolvedValue(mockLogs);

      const result = await service.getRecentActivity('tenant-1');

      expect(result).toHaveLength(2);
      expect(result[0].text).toContain('Order approved');
      expect(result[1].text).toContain('Order rejected');
    });
  });

  describe('saveDraftCorrections', () => {
    it('should throw NotFoundException for missing draft', async () => {
      mockPrisma.aIDraftOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.saveDraftCorrections('tenant-1', 'missing', {}, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-pending draft', async () => {
      mockPrisma.aIDraftOrder.findFirst.mockResolvedValue({
        id: 'draft-1',
        tenantId: 'tenant-1',
        status: AIDraftStatus.APPROVED,
        structuredData: {},
      });

      await expect(
        service.saveDraftCorrections('tenant-1', 'draft-1', {}, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('removes the previous draft items before creating the corrected ones (so approveDraft never re-validates a discarded item)', async () => {
      mockPrisma.aIDraftOrder.findFirst.mockResolvedValue({
        id: 'draft-1',
        tenantId: 'tenant-1',
        status: AIDraftStatus.PENDING,
        structuredData: { items: [{ matched_product_id: 'wrong-product' }] },
      });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.aIDraftOrderItem.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.aIDraftOrderItem.create.mockResolvedValue({});
      mockPrisma.aIDraftOrder.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.saveDraftCorrections(
        'tenant-1',
        'draft-1',
        { items: [{ matched_product_id: 'correct-product', quantity: 1 }] },
        'user-1',
      );

      // The old items must actually be removed, not merely touched/updated —
      // otherwise approveDraft() later validates both the old and new item.
      expect(mockPrisma.aIDraftOrderItem.deleteMany).toHaveBeenCalledWith({
        where: { draftOrderId: 'draft-1', tenantId: 'tenant-1' },
      });
      // deleteMany must run before the corrected item is created.
      const deleteOrder = mockPrisma.aIDraftOrderItem.deleteMany.mock.invocationCallOrder[0];
      const createOrder = mockPrisma.aIDraftOrderItem.create.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(createOrder);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics metrics', async () => {
      const mockOrders = [
        { status: OrderStatus.APPROVED, totalAmount: 100, createdAt: new Date() },
        { status: OrderStatus.SYNCED, totalAmount: 50, createdAt: new Date() },
      ];
      const mockDrafts = [
        { overallConfidence: 0.9, status: AIDraftStatus.APPROVED },
        { overallConfidence: 0.8, status: AIDraftStatus.REJECTED },
      ];
      
      mockPrisma.order.findMany
        .mockResolvedValueOnce(mockOrders) // ordersLast30Days
        .mockResolvedValueOnce(mockOrders); // allOrders
      
      mockPrisma.aIDraftOrder.findMany.mockResolvedValue(mockDrafts);

      const result = await service.getAnalytics('tenant-1');

      expect(result.totalOrders).toBe(2);
      expect(result.totalDrafts).toBe(2);
      expect(result.totalRevenue).toBe(150);
      expect(result.aiConfidenceAvg).toBe(85);
      expect(result.approvalRate).toBe(50);
      expect(result.statusBreakdown[OrderStatus.APPROVED]).toBe(1);
      expect(result.statusBreakdown[OrderStatus.SYNCED]).toBe(1);
    });
  });
});
