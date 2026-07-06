import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { UserRole } from '@prisma/client';

/**
 * AuthService
 *
 * Handles business registration, authentication, and token issuance.
 *
 * Registration creates:
 *   1. A new Tenant (the business)
 *   2. An OWNER User for that tenant
 *
 * Token strategy:
 *   - Access tokens: short-lived (15m), carry tenantId for row-level scoping
 *   - Refresh tokens: long-lived (7d), opaque random string, hashed in DB
 *
 * Isolation: Every token carries tenantId so every downstream
 * service can enforce row-level tenant scoping.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Register a new business (tenant) and its owner account.
   * Returns access + refresh tokens so the owner is immediately logged in.
   */
  async register(dto: RegisterDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: object;
  }> {
    // Check if email is already registered across all tenants
    const existingUser = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    // Generate IDs in the backend (per architecture rules)
    const tenantId = uuidv4();
    const userId = uuidv4();

    // Generate URL-safe slug from business name
    const slug = this.generateSlug(dto.businessName);
    const existingTenant = await this.prisma.tenant.findUnique({ where: { slug } });
    const finalSlug = existingTenant ? `${slug}-${Date.now()}` : slug;

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    // Create tenant + owner in a single transaction
    const { tenant, user } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: tenantId,
          name: dto.businessName,
          slug: finalSlug,
        },
      });

      const user = await tx.user.create({
        data: {
          id: userId,
          tenantId: tenant.id,
          name: dto.ownerName,
          email: dto.email,
          passwordHash,
          role: UserRole.OWNER,
        },
      });

      return { tenant, user };
    });

    this.logger.log(`New tenant registered: ${tenant.name} (${tenant.id})`);

    // Audit log: registration
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        tenantId,
        actorUserId: userId,
        actorType: 'USER',
        action: 'USER_REGISTERED',
        entityType: 'User',
        entityId: userId,
        afterState: {
          email: user.email,
          role: user.role,
          tenantName: tenant.name,
        },
      },
    });

    const accessToken = this.issueAccessToken(user.id, tenant.id, user.email, user.role);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: tenant.id,
        businessName: tenant.name,
      },
    };
  }

  /**
   * Authenticate a user and return access + refresh tokens.
   */
  async login(dto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: object;
  }> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null, isActive: true },
      include: { tenant: true },
    });

    if (!user) {
      // Generic message — don't reveal whether email exists
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    this.logger.log(`User logged in: ${user.email} (tenant: ${user.tenantId})`);

    // Audit log: login
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        tenantId: user.tenantId,
        actorUserId: user.id,
        actorType: 'USER',
        action: 'USER_LOGIN',
        entityType: 'User',
        entityId: user.id,
        afterState: { email: user.email },
      },
    });

    const accessToken = this.issueAccessToken(
      user.id,
      user.tenantId,
      user.email,
      user.role,
    );
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        businessName: user.tenant.name,
      },
    };
  }

  /**
   * Exchange a valid refresh token for a new access + refresh token pair.
   * The old refresh token is invalidated (rotation) to limit replay window.
   */
  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    // Hash the incoming token to compare with stored hash
    const tokenHash = this.hashToken(refreshToken);

    // Find user by refresh token hash
    const user = await this.prisma.user.findFirst({
      where: {
        refreshTokenHash: tokenHash,
        deletedAt: null,
        isActive: true,
      },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Issue new token pair (rotate the refresh token)
    const newAccessToken = this.issueAccessToken(
      user.id,
      user.tenantId,
      user.email,
      user.role,
    );
    const newRefreshToken = await this.issueRefreshToken(user.id);

    this.logger.log(`Token refreshed for user: ${user.email}`);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Invalidate the user's refresh token (logout).
   */
  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });

    this.logger.log(`User logged out: ${userId}`);
  }

  // ── Private helpers ───────────────────────────────────────────

  private issueAccessToken(
    userId: string,
    tenantId: string,
    email: string,
    role: string,
  ): string {
    const payload: JwtPayload = { sub: userId, tenantId, email, role };
    return this.jwtService.sign(payload);
  }

  /**
   * Generate an opaque refresh token, hash it, and store in the user record.
   * Returns the raw (unhashed) token to send to the client.
   */
  private async issueRefreshToken(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: tokenHash },
    });

    return rawToken;
  }

  /**
   * SHA-256 hash of a token string.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
}
