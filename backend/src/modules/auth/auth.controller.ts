import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

/**
 * AuthController
 *
 * Exposes public authentication endpoints.
 * Business logic lives entirely in AuthService.
 */
/**
 * Credential endpoints are unauthenticated and directly guessable, so they get
 * a far tighter ceiling than the global 100/min: 5 attempts per minute per IP
 * by default. This overrides the 'long' bucket for these handlers only — the
 * global 'short' burst limit still applies on top.
 *
 * Configurable because one fixed number cannot suit every deployment:
 *   - the E2E suite registers a fresh tenant per test and legitimately needs
 *     more than five requests a minute from one address;
 *   - offices behind NAT and mobile carriers behind CGNAT share a single
 *     public IP across many real users.
 *
 * Read from process.env rather than ConfigService because decorators are
 * evaluated at class-definition time, before ConfigModule has loaded .env.
 * These must therefore be REAL environment variables (as Render and CI
 * provide them) — putting them only in a .env file will not take effect.
 * The defaults are the secure ones, so an unset variable is always safe.
 */
const CREDENTIAL_RATE_LIMIT = {
  long: {
    limit: Number(process.env.AUTH_RATE_LIMIT ?? 5),
    ttl: Number(process.env.AUTH_RATE_TTL_MS ?? 60_000),
  },
};

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(CREDENTIAL_RATE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new business (tenant) and owner' })
  @ApiResponse({ status: 201, description: 'Business registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() dto: RegisterDto) {
    const result = await this.authService.register(dto);
    return {
      success: true,
      message: 'Business registered successfully',
      data: result,
    };
  }

  @Post('login')
  @Throttle(CREDENTIAL_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    const result = await this.authService.login(dto);
    return {
      success: true,
      message: 'Login successful',
      data: result,
    };
  }

  /**
   * Exchange a valid refresh token for new access + refresh tokens.
   * Public endpoint — no JWT guard required (the refresh token IS the credential).
   */
  @Post('refresh')
  @Throttle(CREDENTIAL_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange refresh token for new access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    const result = await this.authService.refreshTokens(dto.refreshToken);
    return {
      success: true,
      message: 'Token refreshed successfully',
      data: result,
    };
  }

  /**
   * Logout — invalidates the user's refresh token.
   * Requires a valid access token.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@CurrentUser() user: JwtPayload) {
    await this.authService.logout(user.sub);
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Returns the current user details' })
  me(@CurrentUser() user: JwtPayload) {
    return {
      success: true,
      data: user,
    };
  }
}
