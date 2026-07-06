import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

/** Fields safe to return — never expose passwordHash or refreshTokenHash. */
const USER_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/**
 * UsersService
 *
 * Tenant-scoped team management (OWNER-operated). Enforces:
 *  - Tenant isolation on every query.
 *  - No privilege escalation to SUPER_ADMIN via the tenant API.
 *  - Business safety: a tenant can never lose its last active OWNER, and an
 *    owner cannot lock themselves out (self-deactivate / self-delete).
 * Every mutation is written to the immutable audit trail (§13, §19).
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly SALT_ROUNDS = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = { tenantId, deletedAt: null };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async create(tenantId: string, actorUserId: string, dto: CreateUserDto) {
    this.assertAssignableRole(dto.role);

    // Email is unique per tenant (schema @@unique([tenantId, email])).
    const existing = await this.prisma.user.findFirst({
      where: { tenantId, email: dto.email, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
    const id = uuidv4();

    const user = await this.prisma.user.create({
      data: {
        id,
        tenantId,
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
      },
      select: USER_SELECT,
    });

    await this.auditLog.create({
      tenantId,
      actorUserId,
      actorType: 'USER',
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: id,
      afterState: { email: user.email, role: user.role, name: user.name },
    });

    this.logger.log(`[${tenantId}] User created: ${user.email} (${user.role})`);
    return user;
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateUserDto,
  ) {
    const current = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (dto.role !== undefined) {
      this.assertAssignableRole(dto.role);
    }

    // Guard the tenant's last active OWNER against demotion/deactivation.
    const losesOwner =
      current.role === UserRole.OWNER &&
      ((dto.role !== undefined && dto.role !== UserRole.OWNER) ||
        dto.isActive === false);
    if (losesOwner) {
      await this.assertNotLastOwner(tenantId, id);
    }

    // An owner cannot deactivate their own account (self-lockout).
    if (dto.isActive === false && id === actorUserId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: USER_SELECT,
    });

    await this.auditLog.create({
      tenantId,
      actorUserId,
      actorType: 'USER',
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: id,
      beforeState: {
        name: current.name,
        role: current.role,
        isActive: current.isActive,
      },
      afterState: {
        name: updated.name,
        role: updated.role,
        isActive: updated.isActive,
      },
    });

    return updated;
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    if (id === actorUserId) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    const current = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (current.role === UserRole.OWNER) {
      await this.assertNotLastOwner(tenantId, id);
    }

    // Soft delete + revoke any active session.
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, refreshTokenHash: null },
    });

    await this.auditLog.create({
      tenantId,
      actorUserId,
      actorType: 'USER',
      action: 'USER_DELETED',
      entityType: 'User',
      entityId: id,
      beforeState: { email: current.email, role: current.role },
    });

    this.logger.log(`[${tenantId}] User soft-deleted: ${current.email}`);
    return { id, deleted: true };
  }

  // ── Guards ─────────────────────────────────────────────────────

  private assertAssignableRole(role: UserRole) {
    if (role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException(
        'SUPER_ADMIN is a platform role and cannot be assigned through the tenant Users API',
      );
    }
  }

  private async assertNotLastOwner(tenantId: string, excludingUserId: string) {
    const otherOwners = await this.prisma.user.count({
      where: {
        tenantId,
        role: UserRole.OWNER,
        isActive: true,
        deletedAt: null,
        id: { not: excludingUserId },
      },
    });
    if (otherOwners === 0) {
      throw new BadRequestException(
        'This is the tenant’s last active owner and cannot be demoted, deactivated, or removed',
      );
    }
  }
}
