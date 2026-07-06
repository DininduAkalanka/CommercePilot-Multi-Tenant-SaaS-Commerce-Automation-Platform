/**
 * IWhatsAppAdapter
 *
 * Abstraction over WhatsApp message sending.
 * Implementations:
 *   - MockWhatsAppAdapter   (dev, no real account needed)
 *   - MetaCloudWhatsAppAdapter (production, Meta Business API)
 *
 * Architecture Rule: Business logic never calls Meta API directly.
 * It always calls this interface so adapters are swappable.
 */
export interface IWhatsAppAdapter {
  /**
   * Send a plain text message to a phone number.
   */
  sendTextMessage(phone: string, message: string): Promise<SendMessageResult>;

  /**
   * Send a pre-approved template message.
   * Required for messages outside the 24-hour customer-initiated window.
   */
  sendTemplateMessage(
    phone: string,
    templateName: string,
    languageCode: string,
    components: TemplateComponent[],
  ): Promise<SendMessageResult>;

  /**
   * Mark an incoming message as read (shows blue ticks to customer).
   */
  markAsRead(messageId: string): Promise<void>;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: Array<{
    type: 'text' | 'currency' | 'date_time';
    text?: string;
  }>;
}

export const WHATSAPP_ADAPTER = 'WHATSAPP_ADAPTER';
