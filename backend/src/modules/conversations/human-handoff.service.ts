import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConversationStateService } from './conversation-state.service';

export interface HandoffState {
  attempts: number;
  handedOff: boolean;
}

/**
 * HumanHandoffService
 *
 * Decides when the AI should stop asking and put a human in the conversation.
 *
 * WHY THIS EXISTS
 * When extraction is incomplete the pipeline routes to `gather_more_info` and
 * sends the customer a clarifying question. Nothing counted those questions,
 * so a customer the AI could not understand was asked again, and again, until
 * they gave up. That is a silently lost sale, and it was the single most
 * common way this system could fail a real customer.
 *
 * The economics are lopsided: a lost order is worth thousands of rupees, two
 * minutes of the owner's time is worth a fraction of that. So the correct bias
 * is to escalate early rather than to keep looking clever.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not hand the customer a phone number. They are already in a
 * WhatsApp conversation with the business; sending them elsewhere discards the
 * context and adds a step people drop out of. The owner is brought into the
 * existing thread instead.
 *
 * It also never claims to be a person. Warm and natural, but if the customer
 * is told a human is coming, that has to be true.
 */
@Injectable()
export class HumanHandoffService {
  private readonly logger = new Logger(HumanHandoffService.name);

  constructor(
    private readonly conversationState: ConversationStateService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Master switch. Disabled restores the previous behaviour exactly — the AI
   * keeps asking and nothing escalates — so this can be turned off without a
   * deploy if it ever misbehaves.
   */
  private get enabled(): boolean {
    return (
      this.configService.get<string>('HANDOFF_ENABLED', 'true') !== 'false'
    );
  }

  /**
   * Clarifying questions allowed before escalating.
   *
   * Two is deliberate. One is too eager — customers routinely leave out a size
   * and supply it happily when asked. By the third failed attempt the AI has
   * demonstrated it cannot parse this customer, and asking again mostly
   * annoys them.
   */
  private get maxClarifications(): number {
    const raw = Number(
      this.configService.get<string>('HANDOFF_MAX_CLARIFICATIONS', '2'),
    );
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 2;
  }

  async getState(tenantId: string, phone: string): Promise<HandoffState> {
    const session = await this.conversationState.getSession(tenantId, phone);

    return {
      attempts: session?.clarificationAttempts ?? 0,
      handedOff: Boolean(session?.handedOffAt),
    };
  }

  /**
   * True when the AI has already asked as many times as it is allowed to.
   * Always false when disabled, so callers need no extra branch.
   */
  async shouldEscalate(tenantId: string, phone: string): Promise<boolean> {
    if (!this.enabled) return false;

    const { attempts, handedOff } = await this.getState(tenantId, phone);

    // Once escalated, stay escalated — the AI must not resume asking behind
    // the owner's back while they are typing a reply.
    return handedOff || attempts >= this.maxClarifications;
  }

  /** Record that a clarifying question was just sent. Returns the new count. */
  async registerClarification(
    tenantId: string,
    phone: string,
  ): Promise<number> {
    // Re-read rather than mutating a caller's copy: updateAfterExtraction
    // writes the session between the caller fetching it and reaching here, so
    // a stale object would silently drop the increment.
    const session = await this.conversationState.getSession(tenantId, phone);
    if (!session) return 0;

    session.clarificationAttempts = (session.clarificationAttempts ?? 0) + 1;
    session.lastUpdatedAt = new Date().toISOString();
    await this.conversationState.saveSession(tenantId, phone, session);

    return session.clarificationAttempts;
  }

  /**
   * Escalate to a human.
   *
   * Idempotent: an already-escalated conversation returns false and emits
   * nothing, so a customer who keeps typing cannot spam the owner.
   */
  async escalate(
    tenantId: string,
    phone: string,
    reason: string,
    context: { customerMessage?: string; missingFields?: string[] } = {},
  ): Promise<boolean> {
    const session = await this.conversationState.getSession(tenantId, phone);
    if (!session) return false;
    if (session.handedOffAt) return false;

    session.handedOffAt = new Date().toISOString();
    session.lastUpdatedAt = session.handedOffAt;
    await this.conversationState.saveSession(tenantId, phone, session);

    this.eventEmitter.emit('conversation.handoff_requested', {
      tenantId,
      phone,
      conversationId: session.conversationId,
      customerId: session.customerId,
      reason,
      customerMessage: context.customerMessage,
      missingFields: context.missingFields ?? session.missingFields,
    });

    this.logger.warn(
      `[${tenantId}] Conversation with ${phone} escalated to a human: ${reason}`,
    );

    return true;
  }

  /**
   * What the customer is told. Honest about a human being involved, and gives
   * no delivery promise the business has not agreed to.
   */
  buildCustomerMessage(): string {
    return (
      'Sorry — I want to make sure we get this right. ' +
      'Let me check with our team and someone will reply here shortly 🙏'
    );
  }
}
