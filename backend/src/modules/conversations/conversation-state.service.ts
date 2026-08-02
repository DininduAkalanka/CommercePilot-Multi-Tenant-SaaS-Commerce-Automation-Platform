import { Injectable, Logger, Inject } from '@nestjs/common';
import { REDIS_SERVICE } from './interfaces/redis-service.interface';
import type { IRedisService } from './interfaces/redis-service.interface';
import { ConversationStage } from '@prisma/client';

/**
 * Conversation session stored in Redis.
 * TTL = 30 minutes (1800 seconds).
 * On expiry, the DB record is marked ABANDONED by a periodic cleanup job.
 */
export interface ConversationSession {
  conversationId: string;
  tenantId: string;
  customerId: string;
  phone: string;
  stage: ConversationStage;
  /** All messages in this conversation, oldest first */
  messageHistory: string[];
  /** Partial order data accumulated across turns */
  partialOrderData: Record<string, unknown>;
  /** Fields still missing from a complete order */
  missingFields: string[];
  createdAt: string; // ISO timestamp
  lastUpdatedAt: string; // ISO timestamp
}

/**
 * ConversationStateService
 *
 * Manages real-time conversation state in Redis.
 * Redis is the source of truth for ACTIVE conversations.
 * PostgreSQL (Conversation model) stores the persistent history.
 *
 * Key pattern: `conv:{tenantId}:{phone}`
 * TTL: 30 minutes — after this, the conversation is considered ABANDONED.
 */
@Injectable()
export class ConversationStateService {
  private readonly logger = new Logger(ConversationStateService.name);
  private readonly TTL_SECONDS = 1800; // 30 minutes
  private readonly KEY_PREFIX = 'conv';

  constructor(
    @Inject(REDIS_SERVICE)
    private readonly redis: IRedisService,
  ) {}

  /**
   * Build the Redis key for a conversation session.
   */
  buildKey(tenantId: string, phone: string): string {
    return `${this.KEY_PREFIX}:${tenantId}:${phone}`;
  }

  /**
   * Get the current session for a customer from Redis.
   * Returns null if no active session exists (e.g., TTL expired).
   */
  async getSession(
    tenantId: string,
    phone: string,
  ): Promise<ConversationSession | null> {
    const key = this.buildKey(tenantId, phone);
    const raw = await this.redis.get(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as ConversationSession;
    } catch {
      this.logger.warn(`Invalid session JSON for key ${key} — purging`);
      await this.redis.del(key);
      return null;
    }
  }

  /**
   * Create a new conversation session in Redis.
   */
  async createSession(
    conversationId: string,
    tenantId: string,
    customerId: string,
    phone: string,
  ): Promise<ConversationSession> {
    const session: ConversationSession = {
      conversationId,
      tenantId,
      customerId,
      phone,
      stage: ConversationStage.ACTIVE,
      messageHistory: [],
      partialOrderData: {},
      missingFields: [],
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };

    await this.saveSession(tenantId, phone, session);
    this.logger.log(
      `[${tenantId}] New conversation session created for ${phone}`,
    );
    return session;
  }

  /**
   * Append a message to the session history and update the TTL.
   * Messages are stored as plain text for the AI context window.
   */
  async appendMessage(
    tenantId: string,
    phone: string,
    role: 'customer' | 'bot',
    message: string,
  ): Promise<ConversationSession | null> {
    const session = await this.getSession(tenantId, phone);
    if (!session) return null;

    const formatted = `[${role.toUpperCase()}]: ${message}`;
    session.messageHistory.push(formatted);

    // Keep last 10 messages to stay within token limits
    if (session.messageHistory.length > 10) {
      session.messageHistory = session.messageHistory.slice(-10);
    }

    session.lastUpdatedAt = new Date().toISOString();
    await this.saveSession(tenantId, phone, session);
    return session;
  }

  /**
   * Update the partial order data and missing fields after each AI extraction.
   */
  async updatePartialOrder(
    tenantId: string,
    phone: string,
    partialOrderData: Record<string, unknown>,
    missingFields: string[],
    newStage: ConversationStage,
  ): Promise<void> {
    const session = await this.getSession(tenantId, phone);
    if (!session) return;

    session.partialOrderData = {
      ...session.partialOrderData,
      ...partialOrderData,
    };
    session.missingFields = missingFields;
    session.stage = newStage;
    session.lastUpdatedAt = new Date().toISOString();

    await this.saveSession(tenantId, phone, session);
  }

  /**
   * Delete the Redis session (called when conversation completes or is abandoned).
   */
  async deleteSession(tenantId: string, phone: string): Promise<void> {
    const key = this.buildKey(tenantId, phone);
    await this.redis.del(key);
    this.logger.log(`[${tenantId}] Conversation session cleared for ${phone}`);
  }

  /**
   * Check if an active session exists for a given customer.
   */
  async hasActiveSession(tenantId: string, phone: string): Promise<boolean> {
    const key = this.buildKey(tenantId, phone);
    return this.redis.exists(key);
  }

  // ── Private helpers ─────────────────────────────────────────────

  async saveSession(
    tenantId: string,
    phone: string,
    session: ConversationSession,
  ): Promise<void> {
    const key = this.buildKey(tenantId, phone);
    await this.redis.set(key, JSON.stringify(session), this.TTL_SECONDS);
  }
}
