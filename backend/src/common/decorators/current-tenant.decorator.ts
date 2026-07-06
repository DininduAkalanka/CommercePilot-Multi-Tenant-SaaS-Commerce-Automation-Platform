import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentTenant decorator
 *
 * Extracts the tenantId from the JWT payload on any authenticated request.
 * Usage: @CurrentTenant() tenantId: string
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.tenantId;
  },
);
