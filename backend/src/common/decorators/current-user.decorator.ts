import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentUser decorator
 *
 * Extracts the full user object or a specific property from the JWT payload.
 * Usage:
 *   @CurrentUser() user: JwtPayload       — returns full payload
 *   @CurrentUser('tenantId') tenantId: string — returns specific field
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
