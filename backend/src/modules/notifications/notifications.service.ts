import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import {
  NotificationType,
  NotificationChannel,
  NotificationStatus,
} from '@prisma/client';

export interface EmailOptions {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
  type: NotificationType;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;
  private emailFrom: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const provider = this.configService.get<string>(
      'EMAIL_PROVIDER',
      'mailhog',
    );

    // Setup transporter based on provider
    if (provider === 'mailhog') {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST', 'localhost'),
        port: this.configService.get<number>('SMTP_PORT', 1025),
        secure: this.configService.get<boolean>('SMTP_SECURE', false),
        ignoreTLS: true,
      });
    } else {
      // Setup real SMTP or Resend logic here later
      this.logger.warn(
        `Email provider '${provider}' not fully implemented, falling back to MailHog config`,
      );
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST'),
        port: this.configService.get<number>('SMTP_PORT'),
        secure: this.configService.get<boolean>('SMTP_SECURE', false),
        auth: {
          user: this.configService.get<string>('SMTP_USER'),
          pass: this.configService.get<string>('SMTP_PASS'),
        },
      });
    }

    const fromName = this.configService.get<string>(
      'EMAIL_FROM_NAME',
      'CommercePilot',
    );
    const fromEmail = this.configService.get<string>(
      'EMAIL_FROM',
      'noreply@commercepilot.dev',
    );
    this.emailFrom = `"${fromName}" <${fromEmail}>`;
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    const notificationId = uuidv4();

    // Create pending notification record.
    // `message` stores a plain-text summary (shown in the dashboard feed) —
    // not the raw HTML email body, which would render as literal markup there.
    await this.prisma.notification.create({
      data: {
        id: notificationId,
        tenantId: options.tenantId,
        type: options.type,
        channel: NotificationChannel.EMAIL,
        title: options.subject,
        message: this.htmlToPlainText(options.html),
        status: NotificationStatus.PENDING,
        metadata: { to: options.to },
      },
    });

    try {
      const info = await this.transporter.sendMail({
        from: this.emailFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });

      this.logger.log(`Email sent to ${options.to}: ${info.messageId}`);

      // Update notification record to SENT
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });

      // Audit Log
      await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId: options.tenantId,
          actorType: 'SYSTEM',
          action: 'NOTIFICATION_SENT',
          entityType: 'Notification',
          entityId: notificationId,
          afterState: { status: 'SENT', channel: 'EMAIL' },
        },
      });

      return true;
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${options.to}`, error);

      // Update notification record to FAILED
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          failedAt: new Date(),
          failReason: error.message,
        },
      });

      // Audit Log
      await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId: options.tenantId,
          actorType: 'SYSTEM',
          action: 'NOTIFICATION_FAILED',
          entityType: 'Notification',
          entityId: notificationId,
          afterState: {
            status: 'FAILED',
            channel: 'EMAIL',
            reason: error.message,
          },
        },
      });

      return false;
    }
  }

  async sendOrderPendingApprovalEmail(
    tenantId: string,
    ownerEmail: string,
    orderNumber: string,
    dashboardUrl: string,
  ) {
    const html = `
      <h2>Action Required: Order Pending Approval</h2>
      <p>A new order (<strong>${orderNumber}</strong>) has been processed by CommercePilot AI and requires your approval.</p>
      <p>Please review and approve the order to finalize processing.</p>
      <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background-color: #00d084; color: #fff; text-decoration: none; border-radius: 5px;">Review Order</a>
    `;

    return this.sendEmail({
      tenantId,
      to: ownerEmail,
      subject: `Action Required: Order ${orderNumber} Pending Approval`,
      html,
      type: NotificationType.ORDER_PENDING_APPROVAL,
    });
  }

  /**
   * A conversation the AI could not resolve has been handed to a human.
   *
   * The customer has already been told someone will reply, so this is the most
   * time-sensitive notification the system sends — it includes the customer's
   * own words so the owner can answer without opening anything first.
   */
  async sendHandoffRequestedEmail(
    tenantId: string,
    ownerEmail: string,
    details: {
      phone: string;
      reason: string;
      customerMessage?: string;
      missingFields?: string[];
      conversationUrl: string;
    },
  ) {
    const missing = details.missingFields?.length
      ? `<p><strong>AI could not determine:</strong> ${details.missingFields.join(', ')}</p>`
      : '';

    const said = details.customerMessage
      ? `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #00d084;background:#f6f6f6;">${details.customerMessage}</blockquote>`
      : '';

    const html = `
      <h2>A customer needs you</h2>
      <p>CommercePilot could not understand an order from <strong>${details.phone}</strong> and has told the customer a person will reply.</p>
      ${said}
      ${missing}
      <p style="color:#666;font-size:13px;">Reason: ${details.reason}</p>
      <p>Please reply to them on WhatsApp.</p>
      <a href="${details.conversationUrl}" style="display: inline-block; padding: 10px 20px; background-color: #00d084; color: #fff; text-decoration: none; border-radius: 5px;">Open conversations</a>
    `;

    return this.sendEmail({
      tenantId,
      to: ownerEmail,
      subject: `Customer needs a human: ${details.phone}`,
      html,
      type: NotificationType.SYSTEM_ALERT,
    });
  }

  async sendStockAlertEmail(
    tenantId: string,
    ownerEmail: string,
    productName: string,
    available: number,
    requested: number,
  ) {
    const html = `
      <h2>Stock Alert: Insufficient Inventory</h2>
      <p>An order could not be approved due to insufficient stock for <strong>${productName}</strong>.</p>
      <ul>
        <li>Available Stock: ${available}</li>
        <li>Requested Quantity: ${requested}</li>
      </ul>
      <p>Please restock the item or contact the customer to resolve the conflict.</p>
    `;

    return this.sendEmail({
      tenantId,
      to: ownerEmail,
      subject: `Stock Alert: Insufficient Inventory for ${productName}`,
      html,
      type: NotificationType.LOW_STOCK_ALERT,
    });
  }

  async sendOrderSyncFailedEmail(
    tenantId: string,
    ownerEmail: string,
    orderId: string,
    errorMsg: string,
  ) {
    const html = `
      <h2>System Alert: Order Sync Failed</h2>
      <p>Failed to sync order <strong>${orderId}</strong> to WooCommerce.</p>
      <p>Error details: ${errorMsg}</p>
      <p>Please review the integrations dashboard to retry syncing the order.</p>
    `;

    return this.sendEmail({
      tenantId,
      to: ownerEmail,
      subject: `System Alert: Order Sync Failed for ${orderId}`,
      html,
      type: NotificationType.SYSTEM_ALERT,
    });
  }

  async getNotifications(
    tenantId: string,
    filters: { page?: number; limit?: number; status?: string },
  ) {
    const { page = 1, limit = 20, status } = filters;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status) {
      where.status = status as NotificationStatus;
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Reduce an internally-authored HTML email body to a plain-text summary
   * for display in the notification feed. Not a general-purpose HTML
   * sanitizer — templates here are small and authored by this service only.
   */
  private htmlToPlainText(html: string): string {
    return html
      .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
