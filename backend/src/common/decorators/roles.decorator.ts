import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Roles decorator
 *
 * Marks a route with required roles for the RolesGuard to check.
 * Usage: @Roles(UserRole.OWNER, UserRole.STAFF)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
