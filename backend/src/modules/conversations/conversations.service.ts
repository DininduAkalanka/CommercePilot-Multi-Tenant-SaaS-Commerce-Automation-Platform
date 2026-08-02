import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import {
  ConversationStateService,
  ConversationSession,
} from './conversation-state.service';
import { ConversationStage, ConversationStatus } from '@prisma/client';

export interface ActiveConversationResult {
  conversation: { id: string; customerId: string; phone: string };
  session: ConversationSession;
  isNew: boolean;
}

/**
 * ConversationsService
 *
 * Orchestrates the two-layer conversation system:
 *   - Layer 1 (Hot): Redis session via ConversationStateService
 *   - Layer 2 (Cold): PostgreSQL Conversation record via PrismaService
 *
 * Responsibilities:
 *   1. Find or create a Conversation record in DB + Redis session
 *   2. Add messages to session history
 *   3. Transition conversation stages
 *   4. Complete or abandon conversations
 *
 * Architecture Rule: Business logic lives here. WhatsApp module
 * simply calls this service — it does NOT touch the Conversation table directly.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationState: ConversationStateService,
  ) {}

  /**
   * Find an existing ACTIVE conversation for this tenant+phone,
   * or create a new one if none exists (or previous one expired/completed).
   *
   * This is called at the start of every incoming message processing.
   */
  async findOrCreateConversation(
    tenantId: string,
    customerId: string,
    phone: string,
  ): Promise<ActiveConversationResult> {
    // Check Redis first (hot path — avoids DB call for ongoing conversations)
    const existingSession = await this.conversationState.getSession(
      tenantId,
      phone,
    );

    if (existingSession) {
      this.logger.log(
        `[${tenantId}] Resuming existing conversation for ${phone}`,
      );
      return {
        conversation: {
          id: existingSession.conversationId,
          customerId: existingSession.customerId,
          phone: existingSession.phone,
        },
        session: existingSession,
        isNew: false,
      };
    }

    // Redis session expired — check if there's an ACTIVE DB record
    // (could happen if backend restarted and Redis was cleared)
    const existingDbConversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        phone,
        status: ConversationStatus.ACTIVE,
      },
      orderBy: { startedAt: 'desc' },
    });

    if (existingDbConversation) {
      // Recreate Redis session from DB record (hydration after restart)
      this.logger.log(
        `[${tenantId}] Hydrating conversation from DB for ${phone}`,
      );
      const session = await this.conversationState.createSession(
        existingDbConversation.id,
        tenantId,
        customerId,
        phone,
      );
      return {
        conversation: existingDbConversation,
        session,
        isNew: false,
      };
    }

    // Truly new conversation — create in DB and Redis
    return this.startNewConversation(tenantId, customerId, phone);
  }

  /**
   * Append a customer message to the active conversation history.
   */
  async addCustomerMessage(
    tenantId: string,
    phone: string,
    message: string,
  ): Promise<void> {
    await this.conversationState.appendMessage(
      tenantId,
      phone,
      'customer',
      message,
    );

    // Update lastMessageAt in DB
    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: { lastMessageAt: new Date() },
    });
  }

  /**
   * Append a bot reply to the conversation history.
   */
  async addBotReply(
    tenantId: string,
    phone: string,
    reply: string,
  ): Promise<void> {
    await this.conversationState.appendMessage(tenantId, phone, 'bot', reply);
  }

  /**
   * Update conversation state after an AI extraction attempt.
   * Called by WhatsAppService after the AI pipeline runs.
   */
  /**
   * Update conversation state after an AI extraction attempt.
   * Called by WhatsAppService after the AI pipeline runs.
   * Merges newly extracted data into the Redis context and resolves next stage.
   */
  async updateAfterExtraction(
    tenantId: string,
    phone: string,
    extractedOrder: any,
    missingFields: string[],
    compositeConfidence: number,
  ): Promise<ConversationStage> {
    const session = await this.conversationState.getSession(tenantId, phone);
    if (!session) {
      throw new Error(`No active session found for phone ${phone}`);
    }

    // Merge extracted data into Redis partialOrderData
    const mergedData = this.mergeExtractionData(
      session.partialOrderData,
      extractedOrder,
    );

    // Solve next stage transition rules
    let nextStage = session.stage;
    const hasRequiredMissing = missingFields.some((f) =>
      ['product', 'quantity'].includes(f),
    );

    if (session.stage === ConversationStage.ACTIVE) {
      if (hasRequiredMissing) {
        nextStage = ConversationStage.GATHERING_INFO;
      } else {
        if (compositeConfidence > 0.6) {
          nextStage = ConversationStage.PENDING_ORDER;
        } else {
          nextStage = ConversationStage.GATHERING_INFO;
        }
      }
    } else if (session.stage === ConversationStage.GATHERING_INFO) {
      if (!hasRequiredMissing) {
        if (compositeConfidence > 0.8) {
          nextStage = ConversationStage.CONFIRMING;
        } else if (compositeConfidence > 0.6) {
          nextStage = ConversationStage.PENDING_ORDER;
        }
      }
    }

    // Save session in Redis
    session.partialOrderData = mergedData;
    session.missingFields = missingFields;
    session.stage = nextStage;
    session.lastUpdatedAt = new Date().toISOString();
    await this.conversationState.saveSession(tenantId, phone, session);

    // Persist stage and context to DB
    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: {
        currentStage: nextStage,
        partialOrderData: mergedData as object,
        lastMessageAt: new Date(),
      },
    });

    return nextStage;
  }

  /**
   * Transition conversation stage manually.
   */
  async transitionStage(
    tenantId: string,
    phone: string,
    newStage: ConversationStage,
  ): Promise<void> {
    const session = await this.conversationState.getSession(tenantId, phone);
    if (session) {
      session.stage = newStage;
      session.lastUpdatedAt = new Date().toISOString();
      await this.conversationState.saveSession(tenantId, phone, session);
    }

    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: {
        currentStage: newStage,
        lastMessageAt: new Date(),
      },
    });

    this.logger.log(
      `[${tenantId}] Conversation transitioned to ${newStage} for ${phone}`,
    );
  }

  /**
   * Context accumulator: Merges newly extracted elements across turns.
   */
  private mergeExtractionData(currentData: any, extraction: any): any {
    const data = currentData || {
      gathered: {},
      pendingItems: [],
      deliveryInfo: {},
    };
    if (!data.gathered) data.gathered = {};
    if (!data.pendingItems) data.pendingItems = [];
    if (!data.deliveryInfo) data.deliveryInfo = {};

    // 1. Merge attributes into standard gathered map
    if (extraction.items) {
      for (const item of extraction.items) {
        if (item.selected_attributes) {
          for (const [key, val] of Object.entries(item.selected_attributes)) {
            if (val) {
              data.gathered[key] = val;
            }
          }
        }
      }
    }

    // 2. Merge items
    if (extraction.items && extraction.items.length > 0) {
      for (const newItem of extraction.items) {
        const matchIndex = data.pendingItems.findIndex(
          (i: any) =>
            (i.matched_product_id &&
              i.matched_product_id === newItem.matched_product_id) ||
            (i.product_query &&
              i.product_query.toLowerCase() ===
                newItem.product_query.toLowerCase()),
        );

        if (matchIndex > -1) {
          const existing = data.pendingItems[matchIndex];
          data.pendingItems[matchIndex] = {
            ...existing,
            ...newItem,
            quantity: newItem.quantity ?? existing.quantity,
            selected_attributes: {
              ...existing.selected_attributes,
              ...newItem.selected_attributes,
            },
          };
        } else {
          data.pendingItems.push(newItem);
        }
      }
    }

    // 3. Merge delivery info
    if (extraction.delivery_info) {
      data.deliveryInfo = {
        ...data.deliveryInfo,
        ...extraction.delivery_info,
      };
      if (extraction.delivery_info.address) {
        data.gathered.delivery_address = extraction.delivery_info.address;
      }
    }

    return data;
  }

  /**
   * Mark a conversation as COMPLETED.
   * Called when a draft order has been successfully created.
   * Clears the Redis session and updates the DB record.
   */
  async completeConversation(tenantId: string, phone: string): Promise<void> {
    await this.conversationState.deleteSession(tenantId, phone);

    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: {
        status: ConversationStatus.COMPLETED,
        currentStage: ConversationStage.CLOSED,
        endedAt: new Date(),
      },
    });

    this.logger.log(`[${tenantId}] Conversation completed for ${phone}`);
  }

  /**
   * Mark a conversation as ABANDONED.
   * Called by cleanup jobs when Redis TTL expires without completion.
   */
  async abandonConversation(tenantId: string, phone: string): Promise<void> {
    await this.conversationState.deleteSession(tenantId, phone);

    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: {
        status: ConversationStatus.ABANDONED,
        endedAt: new Date(),
      },
    });

    this.logger.log(`[${tenantId}] Conversation abandoned for ${phone}`);
  }

  /**
   * Get the full message history for an active conversation session.
   * Returns an empty array if no active session exists.
   */
  async getMessageHistory(tenantId: string, phone: string): Promise<string[]> {
    const session = await this.conversationState.getSession(tenantId, phone);
    return session?.messageHistory ?? [];
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async startNewConversation(
    tenantId: string,
    customerId: string,
    phone: string,
  ): Promise<ActiveConversationResult> {
    const conversationId = uuidv4();

    // Create DB record — source of truth for conversation history
    const conversation = await this.prisma.conversation.create({
      data: {
        id: conversationId,
        tenantId,
        customerId,
        phone,
        status: ConversationStatus.ACTIVE,
        currentStage: ConversationStage.ACTIVE,
      },
    });

    // Create Redis session — source of truth for active state
    const session = await this.conversationState.createSession(
      conversationId,
      tenantId,
      customerId,
      phone,
    );

    this.logger.log(
      `[${tenantId}] New conversation started: ${conversationId} for ${phone}`,
    );

    return { conversation, session, isNew: true };
  }
}
