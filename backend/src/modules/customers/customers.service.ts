import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

/**
 * CustomersService
 *
 * Manages customer data within the multi-tenant boundary.
 * Customers are auto-created from WhatsApp interactions.
 * All queries MUST include tenantId to enforce tenant isolation.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get paginated customers for a tenant, with optional search by name or phone.
   */
  async findAll(
    tenantId: string,
    page: number = 1,
    limit: number = 15,
    search?: string,
  ) {
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          _count: {
            select: { orders: true, whatsappMessages: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      customers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a specific customer with their complete order and conversation history.
   */
  async findOne(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      include: {
        _count: {
          select: { orders: true, whatsappMessages: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return customer;
  }

  /**
   * Get all orders for a specific customer.
   * Enforces tenant isolation — customer must belong to the requesting tenant.
   */
  async findCustomerOrders(tenantId: string, customerId: string) {
    // First verify the customer belongs to this tenant (prevents cross-tenant access)
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const orders = await this.prisma.order.findMany({
      where: {
        customerId,
        tenantId,
        deletedAt: null,
      },
      include: {
        items: {
          include: { product: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders;
  }

  /**
   * Get WhatsApp conversation history for a specific customer.
   * Returns all messages in chronological order.
   * Enforces tenant isolation.
   */
  async findCustomerMessages(tenantId: string, customerId: string, limit: number = 50) {
    // First verify the customer belongs to this tenant
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const messages = await this.prisma.whatsAppMessage.findMany({
      where: {
        customerId,
        tenantId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Return in chronological order (oldest first for a chat timeline)
    return messages.reverse();
  }
}
