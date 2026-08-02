import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { PrismaService } from '../../common/database/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('CustomersService', () => {
  let service: CustomersService;

  const mockPrisma = {
    customer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
    },
    whatsAppMessage: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── findAll ─────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated customers', async () => {
      const tenantId = 'tenant-1';
      const mockCustomers = [
        { id: 'cust-1', name: 'John', phone: '+94771234567' },
        { id: 'cust-2', name: 'Jane', phone: '+94779876543' },
      ];
      mockPrisma.customer.findMany.mockResolvedValue(mockCustomers);
      mockPrisma.customer.count.mockResolvedValue(2);

      const result = await service.findAll(tenantId);

      expect(result.customers).toEqual(mockCustomers);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
    });

    it('should correctly compute pagination', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(30);

      const result = await service.findAll('tenant-1', 2, 15);

      expect(result.totalPages).toBe(2);
      expect(result.page).toBe(2);
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 15,
          take: 15,
        }),
      );
    });

    it('should filter by tenant_id and exclude soft-deleted records', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll('tenant-1');

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            deletedAt: null,
          }),
        }),
      );
    });

    it('should include OR search clause when search is provided', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll('tenant-1', 1, 15, 'john');

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'john', mode: 'insensitive' } },
              { phone: { contains: 'john', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });
  });

  // ── findOne ─────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return a customer by id', async () => {
      const mockCustomer = {
        id: 'cust-1',
        tenantId: 'tenant-1',
        name: 'John Doe',
      };
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);

      const result = await service.findOne('tenant-1', 'cust-1');

      expect(result).toEqual(mockCustomer);
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-1', tenantId: 'tenant-1', deletedAt: null },
        }),
      );
    });

    it('should throw NotFoundException for missing customer', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not return customer from a different tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-2', 'cust-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findCustomerOrders ──────────────────────────────────────────

  describe('findCustomerOrders', () => {
    it('should return orders for a valid customer', async () => {
      const mockCustomer = {
        id: 'cust-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      };
      const mockOrders = [{ id: 'ord-1', customerId: 'cust-1' }];

      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);
      mockPrisma.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.findCustomerOrders('tenant-1', 'cust-1');

      expect(result).toEqual(mockOrders);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            customerId: 'cust-1',
            tenantId: 'tenant-1',
            deletedAt: null,
          },
        }),
      );
    });

    it('should throw NotFoundException if customer not in tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.findCustomerOrders('tenant-2', 'cust-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findCustomerMessages ────────────────────────────────────────

  describe('findCustomerMessages', () => {
    it('should return reversed messages for a chronological timeline', async () => {
      const mockCustomer = {
        id: 'cust-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      };
      const mockMessages = [
        { id: 'msg-2', messageText: 'Second' },
        { id: 'msg-1', messageText: 'First' },
      ];

      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);
      mockPrisma.whatsAppMessage.findMany.mockResolvedValue(mockMessages);

      const result = await service.findCustomerMessages('tenant-1', 'cust-1');

      // Should be reversed to chronological order (oldest first)
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });

    it('should throw NotFoundException if customer not in tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.findCustomerMessages('tenant-2', 'cust-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
