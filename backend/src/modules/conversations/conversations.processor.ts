import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { ConversationsService } from './conversations.service';
import { ConversationStage, ConversationStatus } from '@prisma/client';
import { WHATSAPP_ADAPTER } from '../whatsapp/interfaces/whatsapp-adapter.interface';
import type { IWhatsAppAdapter } from '../whatsapp/interfaces/whatsapp-adapter.interface';

@Processor('message-processing')
export class ConversationsProcessor {
  private readonly logger = new Logger(ConversationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
    @Inject(WHATSAPP_ADAPTER)
    private readonly whatsappAdapter: any,
  ) {}

  @Process('check-abandoned')
  async handleCheckAbandoned(job: any) {
    const { conversationId, tenantId } = job.data;
    this.logger.log(`[${tenantId}] Checking if conversation ${conversationId} is abandoned`);

    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        this.logger.warn(`Conversation ${conversationId} not found in DB`);
        return;
      }

      // Check if conversation is still ACTIVE and in GATHERING_INFO stage
      if (
        conversation.status === ConversationStatus.ACTIVE &&
        conversation.currentStage === ConversationStage.GATHERING_INFO
      ) {
        const now = Date.now();
        const lastMsgTime = new Date(conversation.lastMessageAt).getTime();
        const inactiveTimeMs = now - lastMsgTime;
        
        // Use 25 seconds for dev verification, 23 hours for production
        const thresholdMs = process.env.NODE_ENV === 'development' ? 25000 : 23 * 60 * 60 * 1000;

        if (inactiveTimeMs >= thresholdMs) {
          // Update status to ABANDONED
          await this.conversationsService.abandonConversation(tenantId, conversation.phone);

          // Cart recovery WhatsApp template
          const followUpMsg = "Hi! We noticed you were asking about an order earlier. Would you like to continue? Just reply here and we'll help you complete your purchase. 😊";
          await this.whatsappAdapter.sendTextMessage(conversation.phone, followUpMsg);

          this.logger.log(`[${tenantId}] Conversation ${conversationId} marked as ABANDONED. Cart recovery follow-up sent.`);
        } else {
          this.logger.log(`[${tenantId}] Conversation ${conversationId} is still active. Skipping abandonment.`);
        }
      } else {
        this.logger.log(`[${tenantId}] Conversation ${conversationId} is in stage ${conversation.currentStage}. Skipping abandonment.`);
      }
    } catch (err: any) {
      this.logger.error(`Error processing check-abandoned job: ${err.message}`);
    }
  }
}
