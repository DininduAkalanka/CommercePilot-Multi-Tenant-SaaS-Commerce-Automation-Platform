import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * JwtStrategy
 *
 * Validates JWT tokens on protected routes.
 * The decoded payload is attached to request.user.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      // Header-only, per API_GUIDELINES.md §15 / SECURITY.md:
      // "Never accept authentication in query parameters." The SSE endpoint
      // (orders/events) authenticates via a fetch-based client that sends
      // this same Authorization header — see frontend/src/lib/sse.ts.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.tenantId) {
      throw new UnauthorizedException('Invalid token: missing tenant context');
    }
    return payload;
  }
}
