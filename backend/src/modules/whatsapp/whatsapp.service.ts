import { Injectable, Logger, Inject, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { AiEngineService } from '../ai-engine/ai-engine.service';
import { ConversationsService } from '../conversations/conversations.service';
import { HumanHandoffService } from '../conversations/human-handoff.service';
import type { IWhatsAppAdapter } from './interfaces/whatsapp-adapter.interface';
import { WHATSAPP_ADAPTER } from './interfaces/whatsapp-adapter.interface';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp.adapter';
import {
  parseReferral,
  buildReferralHint,
} from './interfaces/referral.interface';
import type { WhatsAppReferral } from './interfaces/referral.interface';
import {
  MessageDirection,
  MessageType,
  MessageStatus,
  ConversationStage,
  Prisma,
} from '@prisma/client';

/**
 * WhatsAppService
 *
 * Handles:
 * 1. Parsing incoming Meta webhook payloads
 * 2. Storing messages to DB
 * 3. Finding/creating customer records
 * 4. Managing multi-turn conversation state (Phase 2)
 * 5. Triggering AI processing with conversation context
 * 6. Sending replies
 *
 * Phase 2 change: Every message is now processed within a conversation context.
 * The ConversationsService manages Redis session state across turns.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiEngine: AiEngineService,
    private readonly conversationsService: ConversationsService,
    private readonly humanHandoff: HumanHandoffService,
    private readonly configService: ConfigService,
    @Inject(WHATSAPP_ADAPTER)
    private readonly whatsappAdapter: IWhatsAppAdapter,
    @InjectQueue('message-processing')
    private readonly messageProcessingQueue: Queue,
  ) {}

  /**
   * Handle incoming webhook payload from Meta Cloud API.
   * Parses message, stores it, and triggers async AI processing.
   *
   * IMPORTANT: Always return 200 immediately to Meta.
   * If Meta doesn't get 200 within 20 seconds, it retries the webhook.
   */
  async handleIncomingWebhook(
    payload: Record<string, unknown>,
    signature: string,
    rawBody?: Buffer,
  ): Promise<void> {
    // Signature verification sits OUTSIDE the try/catch below on purpose.
    // A bad signature means the caller is not Meta, and that must surface as
    // a 403 — not be swallowed into the "always return 200" path, which would
    // silently accept forged webhooks.
    const provider = this.configService.get<string>(
      'WHATSAPP_PROVIDER',
      'mock',
    );
    if (provider !== 'mock') {
      this.verifyWebhookSignature(rawBody, signature);
    }

    try {
      const entry = (payload as any)?.entry?.[0];
      if (!entry) return;

      const changes = entry?.changes?.[0];
      if (!changes || changes.field !== 'messages') return;

      const messages = changes?.value?.messages;
      if (!Array.isArray(messages) || messages.length === 0) return;

      // Find the tenant by phone number ID
      const phoneNumberId = changes?.value?.metadata?.phone_number_id;
      const tenant = await this.prisma.tenant.findFirst({
        where: { whatsappPhoneNumberId: phoneNumberId, isActive: true },
      });

      if (!tenant) {
        this.logger.warn(
          `No tenant found for phone number ID: ${phoneNumberId}`,
        );
        return;
      }

      for (const message of messages) {
        await this.processMessage(tenant.id, message);
      }
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`);
      // Don't throw — always return 200 to Meta
    }
  }

  /**
   * Simulate an incoming WhatsApp message (mock mode only).
   * Used by the dashboard simulator for testing without a real Meta account.
   */
  async simulateIncomingMessage(
    tenantId: string,
    phone: string,
    messageText: string,
  ) {
    const adapter = this.whatsappAdapter as MockWhatsAppAdapter;
    const simulated = adapter.simulateIncomingMessage(phone, messageText);

    // Process as if it came from the real webhook
    await this.processIncomingText(
      tenantId,
      phone,
      messageText,
      simulated.messageId,
    );

    return simulated;
  }

  /**
   * Get messages from mock simulator (for dashboard UI).
   */
  async getSimulatorMessages(tenantId: string): Promise<unknown[]> {
    // Get recent messages from DB for this tenant
    const messages = await this.prisma.whatsAppMessage.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { customer: true },
    });
    return messages;
  }

  // ── Private helpers ────────────────────────────────────────────

  private async processMessage(
    tenantId: string,
    rawMessage: Record<string, unknown>,
  ): Promise<void> {
    const messageType = this.getMessageType(rawMessage.type as string);
    const phone = rawMessage.from as string;
    const externalId = rawMessage.id as string;
    const text = (rawMessage.text as any)?.body ?? '';

    // Meta attaches this when the customer arrived from a Click-to-WhatsApp ad
    // or a post CTA. It names the exact ad/post they tapped, which identifies
    // the product they were looking at before they type a word — the single
    // most reliable signal available, and previously discarded.
    const referral = parseReferral(rawMessage.referral);

    if (messageType !== MessageType.TEXT || !text) {
      this.logger.log(
        `[${tenantId}] Non-text message from ${phone} — skipping`,
      );
      return;
    }

    await this.processIncomingText(tenantId, phone, text, externalId, referral);
  }

  private async processIncomingText(
    tenantId: string,
    phone: string,
    text: string,
    externalMessageId: string,
    referral: WhatsAppReferral | null = null,
  ): Promise<void> {
    // ── Step 1: Deduplicate ──────────────────────────────────────
    const existing = await this.prisma.whatsAppMessage.findFirst({
      where: { externalMessageId },
    });
    if (existing) {
      this.logger.debug(`Duplicate message skipped: ${externalMessageId}`);
      return;
    }

    // ── Step 2: Find or create customer ─────────────────────────
    const customer = await this.findOrCreateCustomer(tenantId, phone);

    // ── Step 3: Find or create conversation (Phase 2) ───────────
    const { conversation, session, isNew } =
      await this.conversationsService.findOrCreateConversation(
        tenantId,
        customer.id,
        phone,
      );

    this.logger.log(
      `[${tenantId}] ${isNew ? 'New' : 'Resumed'} conversation ${conversation.id} for ${phone}`,
    );

    // ── Step 4: Store the message in DB ─────────────────────────
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        id: uuidv4(),
        tenantId,
        customerId: customer.id,
        phone,
        messageText: text,
        direction: MessageDirection.INBOUND,
        messageType: MessageType.TEXT,
        status: MessageStatus.RECEIVED,
        externalMessageId,
        conversationId: conversation.id,
        // Persisted even when nothing consumes it yet: it is attribution data
        // that cannot be recovered later if dropped now.
        referral: referral
          ? (referral as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    // ── Step 5: Append to conversation history ───────────────────
    await this.conversationsService.addCustomerMessage(tenantId, phone, text);

    // ── Intercept CONFIRMING stage before AI pipeline ───────────
    if (session.stage === ConversationStage.CONFIRMING) {
      const trimmedText = text.trim().toLowerCase();
      const isYes =
        /^(yes|yep|y|correct|ok|confirm|sure|yeah|agree|okey|agree|confirm|yeah)/i.test(
          trimmedText,
        );
      const isNo = /^(no|cancel|nope|stop|reject|incorrect|n|cancel)/i.test(
        trimmedText,
      );

      if (isYes) {
        // Transition to PENDING_ORDER
        await this.conversationsService.transitionStage(
          tenantId,
          phone,
          ConversationStage.PENDING_ORDER,
        );

        // Create the draft order in the database from context
        const draftOrderId = await this.aiEngine.createDraftFromContext(
          tenantId,
          customer.id,
          message.id,
          text,
          session.partialOrderData,
          0.9, // Confirmation implies high confidence
        );

        // Send order acknowledgment template
        const shortOrderId = draftOrderId.substring(0, 8);
        const ackMsg = `✅ Thank you! We've received your order and it's being reviewed. We'll confirm shortly with the total amount and delivery details. Your reference number is *CP-${shortOrderId}*.`;

        await this.whatsappAdapter.sendTextMessage(phone, ackMsg);
        await this.conversationsService.addBotReply(tenantId, phone, ackMsg);

        // Complete conversation
        await this.conversationsService.completeConversation(tenantId, phone);
        return;
      } else if (isNo) {
        // Transition back to ACTIVE and clear session
        await this.conversationsService.transitionStage(
          tenantId,
          phone,
          ConversationStage.ACTIVE,
        );
        await this.conversationsService.completeConversation(tenantId, phone); // Deletes Redis session

        const cancelMsg = `Understood. Your order draft has been cancelled. Let me know if you would like to order anything else! 😊`;
        await this.whatsappAdapter.sendTextMessage(phone, cancelMsg);
        return;
      } else {
        // Fallback for random replies in confirming stage
        const fallbackMsg = `Please reply with *Yes* to confirm your order or *No* to cancel.`;
        await this.whatsappAdapter.sendTextMessage(phone, fallbackMsg);
        await this.conversationsService.addBotReply(
          tenantId,
          phone,
          fallbackMsg,
        );
        return;
      }
    }

    // ── Step 6: Get tenant config for AI processing ─────────────
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) return;

    // ── Step 7: Get full conversation history for multi-turn AI ──
    // Include previous messages (excluding the one just added) for context
    const conversationHistory = session.messageHistory;

    // ── Step 8: Run AI pipeline with conversation context ────────
    const result = await this.aiEngine.processMessage({
      tenantId,
      customerId: customer.id,
      messageId: message.id,
      messageText: text,
      conversationHistory, // Phase 2: pass history for multi-turn extraction
      // The ad copy the customer tapped, if any. "Blue Cotton Shirt - New
      // Arrival" is a far better retrieval query than "mata meka one".
      referralHint: buildReferralHint(referral),
      autoApproveEnabled: tenant.autoApproveEnabled,
      autoApproveThreshold: tenant.autoApproveThreshold,
      aiConfidenceThreshold: tenant.aiConfidenceThreshold,
    });

    // ── Step 9: Update conversation state after extraction ───────
    let nextStage: ConversationStage = session.stage;
    if (result.intent === 'ORDER' && result.extractedOrder) {
      nextStage = await this.conversationsService.updateAfterExtraction(
        tenantId,
        phone,
        result.extractedOrder,
        result.missingFields,
        result.overallConfidence,
      );
    }

    // ── Step 10: Send reply and update conversation ──────────────
    if (
      nextStage === ConversationStage.GATHERING_INFO &&
      result.missingFields.length > 0
    ) {
      // The AI could not fully understand the order. Before asking again,
      // check whether it has already asked as many times as it is allowed to —
      // without this the conversation loops until the customer gives up, which
      // is a silently lost sale.
      const escalate = await this.humanHandoff.shouldEscalate(tenantId, phone);

      if (escalate) {
        const handoffMsg = this.humanHandoff.buildCustomerMessage();

        // escalate() is idempotent, so a customer who keeps typing after the
        // handoff gets no further automated replies and the owner is notified
        // exactly once.
        const firstTime = await this.humanHandoff.escalate(
          tenantId,
          phone,
          'AI could not resolve the order after repeated clarifications',
          { customerMessage: text, missingFields: result.missingFields },
        );

        if (firstTime) {
          await this.whatsappAdapter.sendTextMessage(phone, handoffMsg);
          await this.conversationsService.addBotReply(
            tenantId,
            phone,
            handoffMsg,
          );
        }

        this.logger.warn(
          `[${tenantId}] Handed ${phone} to a human instead of asking again`,
        );

        return;
      }

      // Missing fields — format missing info template
      const missingInfoList = result.missingFields.join(', ');
      const missingMsg = `To complete your order, could you please confirm: ${missingInfoList}?`;

      await this.whatsappAdapter.sendTextMessage(phone, missingMsg);
      await this.conversationsService.addBotReply(tenantId, phone, missingMsg);
      await this.humanHandoff.registerClarification(tenantId, phone);

      // Schedule check-abandoned job in BullMQ (30s in dev for easy verification, 24h in prod)
      const delayMs =
        process.env.NODE_ENV === 'development' ? 30000 : 24 * 60 * 60 * 1000;
      await this.messageProcessingQueue.add(
        'check-abandoned',
        { conversationId: session.conversationId, tenantId },
        { delay: delayMs, jobId: `abandoned:${session.conversationId}` },
      );

      this.logger.log(
        `[${tenantId}] Missing info request sent and 24h abandoned check scheduled for ${phone}`,
      );
    } else if (
      nextStage === ConversationStage.CONFIRMING &&
      result.extractedOrder
    ) {
      // All info gathered — ask customer to confirm
      const itemsSummary = result.extractedOrder.items
        .map(
          (i: any) =>
            `- ${i.quantity}x ${i.matched_product_name ?? i.product_query}`,
        )
        .join('\n');
      const confirmPrompt = `Here is your order summary:\n${itemsSummary}\n\nIs this correct? Please reply *Yes* to confirm or *No* to cancel.`;

      await this.whatsappAdapter.sendTextMessage(phone, confirmPrompt);
      await this.conversationsService.addBotReply(
        tenantId,
        phone,
        confirmPrompt,
      );

      this.logger.log(`[${tenantId}] Confirmation prompt sent for ${phone}`);
    } else if (result.draftOrderId) {
      // Draft order created (Directly in ACTIVE turn)
      const shortOrderId = result.draftOrderId.substring(0, 8);
      const ackMsg = `✅ Thank you! We've received your order and it's being reviewed. We'll confirm shortly with the total amount and delivery details. Your reference number is *CP-${shortOrderId}*.`;

      await this.whatsappAdapter.sendTextMessage(phone, ackMsg);
      await this.conversationsService.addBotReply(tenantId, phone, ackMsg);

      // Complete conversation
      await this.conversationsService.completeConversation(tenantId, phone);

      this.logger.log(
        `[${tenantId}] Draft order ${result.draftOrderId} created — conversation completed`,
      );
    }

    this.logger.log(
      `[${tenantId}] AI processing complete: ${result.routing} (confidence: ${(result.overallConfidence * 100).toFixed(1)}%)`,
    );
  }

  private async findOrCreateCustomer(tenantId: string, phone: string) {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });

    if (existing) return existing;

    const customerId = uuidv4();
    const customer = await this.prisma.customer.create({
      data: {
        id: customerId,
        tenantId,
        phone,
        name: `Customer ${phone.slice(-4)}`, // Placeholder name
      },
    });

    // Audit log: customer auto-created
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        tenantId,
        actorType: 'SYSTEM',
        action: 'CUSTOMER_AUTO_CREATED',
        entityType: 'Customer',
        entityId: customerId,
        afterState: { phone, source: 'WHATSAPP' },
      },
    });

    this.logger.log(`[${tenantId}] New customer auto-created: ${phone}`);

    return customer;
  }

  private getMessageType(type: string): MessageType {
    const types: Record<string, MessageType> = {
      text: MessageType.TEXT,
      image: MessageType.IMAGE,
      audio: MessageType.AUDIO,
      video: MessageType.VIDEO,
      document: MessageType.DOCUMENT,
      sticker: MessageType.STICKER,
      location: MessageType.LOCATION,
    };
    return types[type] ?? MessageType.TEXT;
  }

  /**
   * Verify the HMAC-SHA256 signature Meta sends in `x-hub-signature-256`
   * as `sha256=<hex>`.
   *
   * The digest MUST be computed over the raw request bytes. It previously ran
   * over `JSON.stringify(parsedBody)`, which re-serialises the payload — key
   * order, unicode escaping and whitespace all differ from what Meta actually
   * signed, so the digest could never match real traffic. That failure was
   * invisible because the caller swallowed the exception and returned 200:
   * every genuine customer order would have been dropped without a trace.
   *
   * @throws ForbiddenException if the signature is missing, malformed or wrong
   */
  private verifyWebhookSignature(
    rawBody: Buffer | undefined,
    signature: string,
  ): void {
    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      this.logger.warn(
        'WHATSAPP_APP_SECRET not configured — webhook signature verification skipped. ' +
          'This is a security risk in production.',
      );
      return;
    }

    if (!rawBody || rawBody.length === 0) {
      // Without the raw bytes any comparison would be meaningless, so fail
      // closed rather than silently accepting the request.
      this.logger.error(
        'Raw request body unavailable — cannot verify webhook signature. ' +
          'Ensure NestFactory.create is called with { rawBody: true }.',
      );
      throw new ForbiddenException('Unable to verify webhook signature');
    }

    if (!signature) {
      throw new ForbiddenException(
        'Missing webhook signature header (x-hub-signature-256)',
      );
    }

    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest();

    let received: Buffer;
    try {
      received = Buffer.from(signature.replace('sha256=', ''), 'hex');
    } catch {
      throw new ForbiddenException('Malformed webhook signature');
    }

    // timingSafeEqual throws RangeError on a length mismatch, which would
    // escape as a 500 and leak that the length was wrong. Compare lengths
    // first, then compare contents in constant time.
    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      this.logger.warn(
        'Invalid webhook signature received — rejecting payload',
      );
      throw new ForbiddenException('Invalid webhook signature');
    }

    this.logger.debug('Webhook signature verified successfully');
  }
}
