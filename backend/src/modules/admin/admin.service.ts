import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

/**
 * Tenant fields safe to expose to the platform admin.
 * Deliberately omits all Restricted credentials (WhatsApp/WooCommerce secrets).
 */
const TENANT_ADMIN_SELECT = {
  id: true,
  name: true,
  slug: true,
  plan: true,
  isActive: true,
  whatsappProvider: true,
  woocommerceProvider: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  _count: { select: { users: true, orders: true, customers: true, products: true } },
} satisfies Prisma.TenantSelect;

/**
 * AdminService
 *
 * SUPER_ADMIN platform operations. This is the ONLY service permitted to read
 * across tenant boundaries, and it is reachable exclusively through routes
 * gated to the SUPER_ADMIN role. It never exposes tenant credentials.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Cross-tenant list of all businesses on the platform (paginated). */
  async listTenants(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.TenantWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        select: TENANT_ADMIN_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: tenants,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Activate or suspend a tenant platform-wide. Audit-logged against the target tenant. */
  async setTenantStatus(actorUserId: string, tenantId: string, isActive: boolean) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, isActive: true, name: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive },
      select: TENANT_ADMIN_SELECT,
    });

    await this.auditLog.create({
      tenantId,
      actorUserId,
      actorType: 'USER',
      action: isActive ? 'TENANT_ACTIVATED' : 'TENANT_SUSPENDED',
      entityType: 'Tenant',
      entityId: tenantId,
      beforeState: { isActive: tenant.isActive },
      afterState: { isActive },
    });

    this.logger.log(
      `Tenant ${tenant.name} (${tenantId}) ${isActive ? 'activated' : 'suspended'} by ${actorUserId}`,
    );
    return updated;
  }

  /** Platform-wide aggregate metrics. */
  async platformStats() {
    const [tenants, activeTenants, users, orders, products] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.order.count({ where: { deletedAt: null } }),
      this.prisma.product.count({ where: { deletedAt: null } }),
    ]);

    return { tenants, activeTenants, users, orders, products };
  }
}
