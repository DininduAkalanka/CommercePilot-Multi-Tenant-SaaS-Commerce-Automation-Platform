import { Injectable, Logger } from '@nestjs/common';
import {
  IWhatsAppAdapter,
  SendMessageResult,
  TemplateComponent,
} from '../interfaces/whatsapp-adapter.interface';

/**
 * MockWhatsAppAdapter
 *
 * Development adapter — simulates WhatsApp without a real Meta account.
 * All messages are logged to console and stored in memory for the
 * simulator UI in the dashboard to display.
 *
 * Swap to MetaCloudWhatsAppAdapter in production by changing
 * WHATSAPP_PROVIDER=mock → WHATSAPP_PROVIDER=meta in .env
 */
@Injectable()
export class MockWhatsAppAdapter implements IWhatsAppAdapter {
  private readonly logger = new Logger(MockWhatsAppAdapter.name);

  // In-memory message log for simulator UI
  private readonly sentMessages: SentMessage[] = [];

  async sendTextMessage(
    phone: string,
    message: string,
  ): Promise<SendMessageResult> {
    const messageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    this.sentMessages.push({
      id: messageId,
      phone,
      message,
      type: 'text',
      sentAt: new Date(),
    });

    this.logger.log(
      `📱 [MOCK WhatsApp] → ${phone}: ${message.substring(0, 80)}${message.length > 80 ? '...' : ''}`,
    );

    return { success: true, messageId };
  }

  async sendTemplateMessage(
    phone: string,
    templateName: string,
    languageCode: string,
    components: TemplateComponent[],
  ): Promise<SendMessageResult> {
    const messageId = `mock_tpl_${Date.now()}`;

    this.sentMessages.push({
      id: messageId,
      phone,
      message: `[Template: ${templateName}] ${JSON.stringify(components)}`,
      type: 'template',
      sentAt: new Date(),
    });

    this.logger.log(
      `📱 [MOCK WhatsApp] Template "${templateName}" → ${phone}`,
    );

    return { success: true, messageId };
  }

  async markAsRead(_messageId: string): Promise<void> {
    // No-op in mock mode
  }

  /**
   * Returns all sent messages — used by the simulator UI endpoint.
   */
  getSentMessages(): SentMessage[] {
    return [...this.sentMessages].reverse();
  }

  /**
   * Simulates an incoming customer message.
   * Called by the dashboard simulator UI to test the full pipeline.
   */
  simulateIncomingMessage(phone: string, message: string): SimulatedMessage {
    const messageId = `sim_${Date.now()}`;
    this.logger.log(`📱 [MOCK WhatsApp] ← ${phone}: ${message}`);
    return { messageId, phone, message, timestamp: new Date().toISOString() };
  }
}

export interface SentMessage {
  id: string;
  phone: string;
  message: string;
  type: 'text' | 'template';
  sentAt: Date;
}

export interface SimulatedMessage {
  messageId: string;
  phone: string;
  message: string;
  timestamp: string;
}
