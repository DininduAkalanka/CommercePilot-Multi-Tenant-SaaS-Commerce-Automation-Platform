import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

describe('UsersService', () => {
  const prismaUser = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { user: prismaUser } as unknown as PrismaService;
  const auditLog = { create: jest.fn() } as unknown as AuditLogService;

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma, auditLog);
  });

  describe('findAll', () => {
    it('is tenant-scoped, excludes soft-deleted, returns meta', async () => {
      prismaUser.findMany.mockResolvedValue([{ id: 'u1' }]);
      prismaUser.count.mockResolvedValue(1);

      const res = await service.findAll('tenant-1', 1, 20);

      expect(prismaUser.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 'tenant-1',
        deletedAt: null,
      });
      // passwordHash / refreshTokenHash must not be selected.
      const select = prismaUser.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('passwordHash');
      expect(select).not.toHaveProperty('refreshTokenHash');
      expect(res.meta.total).toBe(1);
    });
  });

  describe('create', () => {
    it('rejects assigning SUPER_ADMIN (privilege-escalation guard)', async () => {
      await expect(
        service.create('tenant-1', 'owner-1', {
          name: 'X',
          email: 'x@y.com',
          password: 'Str0ng!Passw0rd',
          role: UserRole.SUPER_ADMIN,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaUser.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email within the tenant', async () => {
      prismaUser.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create('tenant-1', 'owner-1', {
          name: 'X',
          email: 'dupe@y.com',
          password: 'Str0ng!Passw0rd',
          role: UserRole.STAFF,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('hashes the password and never persists plaintext; writes an audit log', async () => {
      prismaUser.findFirst.mockResolvedValue(null);
      prismaUser.create.mockResolvedValue({
        id: 'u2',
        email: 'new@y.com',
        role: UserRole.STAFF,
        name: 'New',
      });

      await service.create('tenant-1', 'owner-1', {
        name: 'New',
        email: 'new@y.com',
        password: 'Str0ng!Passw0rd',
        role: UserRole.STAFF,
      });

      const data = prismaUser.create.mock.calls[0][0].data;
      expect(data.passwordHash).toBeDefined();
      expect(data.passwordHash).not.toBe('Str0ng!Passw0rd');
      expect(data.tenantId).toBe('tenant-1');
      // entityId is the backend-generated UUID used for the created user record.
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_CREATED', entityId: data.id }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFound when the user is not in the tenant', async () => {
      prismaUser.findFirst.mockResolvedValue(null);
      await expect(
        service.update('tenant-1', 'owner-1', 'ghost', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks demoting the last active owner', async () => {
      prismaUser.findFirst.mockResolvedValue({
        id: 'owner-1',
        role: UserRole.OWNER,
        name: 'O',
        isActive: true,
      });
      prismaUser.count.mockResolvedValue(0); // no other owners

      await expect(
        service.update('tenant-1', 'admin', 'owner-1', { role: UserRole.STAFF }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaUser.update).not.toHaveBeenCalled();
    });

    it('blocks an owner from deactivating their own account', async () => {
      prismaUser.findFirst.mockResolvedValue({
        id: 'owner-1',
        role: UserRole.OWNER,
        name: 'O',
        isActive: true,
      });
      prismaUser.count.mockResolvedValue(2); // other owners exist

      await expect(
        service.update('tenant-1', 'owner-1', 'owner-1', { isActive: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('applies a valid update and audits before/after', async () => {
      prismaUser.findFirst.mockResolvedValue({
        id: 'u2',
        role: UserRole.STAFF,
        name: 'Old',
        isActive: true,
      });
      prismaUser.update.mockResolvedValue({
        id: 'u2',
        role: UserRole.STAFF,
        name: 'New',
        isActive: true,
      });

      await service.update('tenant-1', 'owner-1', 'u2', { name: 'New' });

      expect(prismaUser.update).toHaveBeenCalled();
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_UPDATED', entityId: 'u2' }),
      );
    });
  });

  describe('remove', () => {
    it('blocks deleting your own account', async () => {
      await expect(
        service.remove('tenant-1', 'owner-1', 'owner-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks removing the last active owner', async () => {
      prismaUser.findFirst.mockResolvedValue({
        id: 'owner-2',
        role: UserRole.OWNER,
        email: 'o@y.com',
      });
      prismaUser.count.mockResolvedValue(0);

      await expect(
        service.remove('tenant-1', 'owner-1', 'owner-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('soft-deletes and revokes session for a valid staff removal', async () => {
      prismaUser.findFirst.mockResolvedValue({
        id: 'u3',
        role: UserRole.STAFF,
        email: 's@y.com',
      });
      prismaUser.update.mockResolvedValue({});

      const res = await service.remove('tenant-1', 'owner-1', 'u3');

      const data = prismaUser.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
      expect(data.refreshTokenHash).toBeNull();
      expect(res).toEqual({ id: 'u3', deleted: true });
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_DELETED' }),
      );
    });
  });
});
