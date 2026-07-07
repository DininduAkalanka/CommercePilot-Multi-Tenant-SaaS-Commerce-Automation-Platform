import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
  ],
})
export class AppModule {}
