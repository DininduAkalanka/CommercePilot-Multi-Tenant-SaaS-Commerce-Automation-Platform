import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IWhatsAppAdapter,
  SendMessageResult,
  TemplateComponent,
} from '../interfaces/whatsapp-adapter.interface';

/**
 * MetaWhatsAppAdapter
 *
 * Production adapter for the WhatsApp Cloud API (Meta Graph API).
 * Selected when WHATSAPP_PROVIDER=meta.
 *
 * Configuration (environment):
 *   WHATSAPP_PHONE_NUMBER_ID   — sender phone number id
 *   WHATSAPP_ACCESS_TOKEN      — permanent/system-user access token (restricted)
 *   WHATSAPP_API_VERSION       — Graph API version (default v18.0)
 *
 * Architecture rule: business logic never calls Graph directly — only via
 * IWhatsAppAdapter, so mock and real providers stay swappable.
 */
@Injectable()
export class MetaWhatsAppAdapter implements IWhatsAppAdapter {
  private readonly logger = new Logger(MetaWhatsAppAdapter.name);
  private readonly baseUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor(private readonly configService: ConfigService) {
    this.phoneNumberId = this.configService.get<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
      '',
    );
    this.accessToken = this.configService.get<string>(
      'WHATSAPP_ACCESS_TOKEN',
      '',
    );
    const apiVersion = this.configService.get<string>(
      'WHATSAPP_API_VERSION',
      'v18.0',
    );
    this.baseUrl = `https://graph.facebook.com/${apiVersion}`;

    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn(
        'Meta WhatsApp provider selected but WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not fully configured.',
      );
    }
  }

  async sendTextMessage(
    phone: string,
    message: string,
  ): Promise<SendMessageResult> {
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { preview_url: false, body: message },
    });
  }

  async sendTemplateMessage(
    phone: string,
    templateName: string,
    languageCode: string,
    components: TemplateComponent[],
  ): Promise<SendMessageResult> {
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    try {
      await this.post({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch (error) {
      // Read receipts are best-effort — never fail the caller over one.
      this.logger.warn(
        `Failed to mark message ${messageId} as read: ${this.errorMessage(error)}`,
      );
    }
  }

  private async send(
    body: Record<string, unknown>,
  ): Promise<SendMessageResult> {
    try {
      const data = await this.post(body);
      const messageId = this.extractMessageId(data);
      return { success: true, messageId };
    } catch (error) {
      const message = this.errorMessage(error);
      // Never log the recipient's message body or the access token.
      this.logger.error(`WhatsApp send failed: ${message}`);
      return { success: false, error: message };
    }
  }

  private async post(body: Record<string, unknown>): Promise<unknown> {
    if (!this.phoneNumberId || !this.accessToken) {
      throw new Error('WhatsApp Cloud API is not configured');
    }

    const response = await fetch(
      `${this.baseUrl}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const payload: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        `Graph API ${response.status}: ${this.extractApiError(payload)}`,
      );
    }
    return payload;
  }

  private extractMessageId(data: unknown): string | undefined {
    if (
      typeof data === 'object' &&
      data !== null &&
      'messages' in data &&
      Array.isArray(data.messages)
    ) {
      const first = (data as { messages: Array<{ id?: string }> }).messages[0];
      return first?.id;
    }
    return undefined;
  }

  private extractApiError(payload: unknown): string {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'object'
    ) {
      const err = (payload as { error: { message?: string } }).error;
      return err.message ?? 'Unknown Graph API error';
    }
    return 'Unknown Graph API error';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
