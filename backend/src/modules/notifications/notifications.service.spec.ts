import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../common/database/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultVal?: any) => {
      const config: Record<string, any> = {
        EMAIL_PROVIDER: 'mailhog',
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        EMAIL_FROM_NAME: 'CommercePilot',
        EMAIL_FROM: 'noreply@commercepilot.dev',
      };
      return config[key] ?? defaultVal;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getNotifications', () => {
    it('should return paginated notifications', async () => {
      const tenantId = 'tenant-1';
      const mockNotifications = [
        { id: 'notif-1', tenantId, type: 'ORDER_PENDING_APPROVAL' },
        { id: 'notif-2', tenantId, type: 'LOW_STOCK_ALERT' },
      ];
      mockPrisma.notification.findMany.mockResolvedValue(mockNotifications);
      mockPrisma.notification.count.mockResolvedValue(2);

      const result = await service.getNotifications(tenantId, { page: 1, limit: 20 });

      expect(result.items).toEqual(mockNotifications);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by status when provided', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.getNotifications('tenant-1', { status: 'SENT' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', status: 'SENT' },
        }),
      );
    });

    it('should handle empty results', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      const result = await service.getNotifications('tenant-1', {});

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe('sendEmail', () => {
    it('should create a notification record before sending', async () => {
      mockPrisma.notification.create.mockResolvedValue({});
      mockPrisma.notification.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Mock the transporter - the actual send will fail in test env
      // which tests the FAILED path, but the key thing is that the DB record is created first
      const options = {
        tenantId: 'tenant-1',
        to: 'owner@test.com',
        subject: 'Test',
        html: '<p>Test</p>',
        type: 'ORDER_PENDING_APPROVAL' as any,
      };

      // Will likely fail because there's no real SMTP server, testing the error path
      const result = await service.sendEmail(options);

      // Whether it succeeds or fails, the notification record should be created
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            channel: 'EMAIL',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('stores a plain-text summary in `message`, never the raw HTML body', async () => {
      mockPrisma.notification.create.mockResolvedValue({});
      mockPrisma.notification.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const html = `
        <h2>Action Required: Order Pending Approval</h2>
        <p>A new order (<strong>ORD-1</strong>) needs your approval.</p>
        <a href="http://localhost:3000/dashboard/orders/1">Review Order</a>
      `;

      await service.sendEmail({
        tenantId: 'tenant-1',
        to: 'owner@test.com',
        subject: 'Action Required',
        html,
        type: 'ORDER_PENDING_APPROVAL' as any,
      });

      const storedMessage = mockPrisma.notification.create.mock.calls[0][0].data.message;
      expect(storedMessage).not.toContain('<');
      expect(storedMessage).not.toContain('>');
      expect(storedMessage).toContain('Action Required: Order Pending Approval');
      expect(storedMessage).toContain('ORD-1');
      expect(storedMessage).toContain('Review Order (http://localhost:3000/dashboard/orders/1)');
    });
  });
});
