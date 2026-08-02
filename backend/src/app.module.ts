import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bull';
import { buildRedisConnection } from './common/redis/redis.util';
import { DatabaseModule } from './common/database/database.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { AiEngineModule } from './modules/ai-engine/ai-engine.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProductsModule } from './modules/products/products.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TenantSettingsModule } from './modules/tenant-settings/tenant-settings.module';
import { UsersModule } from './modules/users/users.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
/**
 * AppModule — Root module
 *
 * Wires all application modules together.
 * New modules are added here as they are built.
 */
@Module({
  imports: [
    // ── Configuration ───────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── Rate Limiting ────────────────────────────────────────────
    // Every named throttler here applies to every route, so this list stays
    // limited to the general-purpose buckets. Stricter per-route limits (the
    // credential endpoints) are set by overriding 'long' with @Throttle at the
    // handler — adding a tighter named bucket here would apply it site-wide.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'long', ttl: 60000, limit: 100 },
    ]),

    // ── Event Emitter ────────────────────────────────────────────
    EventEmitterModule.forRoot(),

    // ── Bull Queue (Global) ──────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),

    // ── Database (Global) ─────────────────────────────────────────
    DatabaseModule,

    // ── Common Infrastructure (Global) ────────────────────────────
    CommonModule,

    // ── Phase 0: Auth ─────────────────────────────────────────────
    AuthModule,

    // ── Phase 1: Core MVP ─────────────────────────────────────────
    AiEngineModule,
    WhatsAppModule,
    OrdersModule,
    ProductsModule,
    NotificationsModule,

    // ── Phase 2: Intelligence Layer ──────────────────────────────────
    ConversationsModule,

    // ── Phase 3: Integrations Layer ──────────────────────────────────
    IntegrationsModule,

    // ── Phase 4: Core Entities ───────────────────────────────────────
    CustomersModule,
    TenantSettingsModule,

    // ── Phase 6: Architectural Completeness ──────────────────────────
    UsersModule,
    AuditLogsModule,
    AdminModule,

    // ── Ops: liveness/readiness probes for hosting + monitoring ──────
    HealthModule,
  ],
  providers: [
    // ThrottlerModule only supplies configuration — without this binding the
    // guard never runs and every limit above is inert. It was previously
    // applied to a single controller, leaving /auth/login unthrottled and
    // open to credential stuffing.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
