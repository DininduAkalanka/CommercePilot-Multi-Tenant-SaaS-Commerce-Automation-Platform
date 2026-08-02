import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { WHATSAPP_ADAPTER } from './interfaces/whatsapp-adapter.interface';
import type { IWhatsAppAdapter } from './interfaces/whatsapp-adapter.interface';

@Injectable()
export class WhatsAppNotificationListener {
  private readonly logger = new Logger(WhatsAppNotificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_ADAPTER)
    private readonly whatsappAdapter: IWhatsAppAdapter,
  ) {}

  @OnEvent('order.approved')
  async handleOrderApproved(payload: { tenantId: string; orderId: string }) {
    const { tenantId, orderId } = payload;
    this.logger.log(
      `[${tenantId}] Sending WhatsApp confirmation for order ${orderId}`,
    );

    const notificationId = uuidv4();

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId, tenantId },
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
        },
      });

      if (!order || !order.customer) {
        this.logger.error(
          `Order or customer not found for approval notification: ${orderId}`,
        );
        return;
      }

      const shortOrderId = order.id.substring(0, 8);
      const itemsSummary = order.items
        .map((i) => `- ${i.quantity}x ${i.product?.name ?? 'Item'}`)
        .join('\n');

      const currency = 'LKR'; // Default currency
      const total = Number(order.totalAmount).toFixed(2);
      const deliveryInfo = order.deliveryAddress
        ? `Deliver to ${order.deliveryAddress}`
        : 'Details will follow';

      // Template: confirmed
      const msg = `🎉 Your order has been confirmed!\n\n*Order: CP-${shortOrderId}*\n${itemsSummary}\n💰 *Total: ${currency} ${total}*\n📦 *Estimated delivery: ${deliveryInfo}*\n\nThank you for your order! 🙏`;

      // 1. Create DB record
      await this.prisma.notification.create({
        data: {
          id: notificationId,
          tenantId,
          type: 'ORDER_APPROVED',
          channel: 'WHATSAPP',
          title: `Order CP-${shortOrderId} Approved`,
          message: msg,
          status: 'PENDING',
          metadata: { to: order.customer.phone },
        },
      });

      // 2. Send via Adapter
      await this.whatsappAdapter.sendTextMessage(order.customer.phone, msg);

      // 3. Update DB record to SENT
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'SENT', sentAt: new Date() },
      });

      // 4. Audit Log
      await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId,
          actorType: 'SYSTEM',
          action: 'NOTIFICATION_SENT',
          entityType: 'Notification',
          entityId: notificationId,
          afterState: { status: 'SENT', channel: 'WHATSAPP' },
        },
      });

      this.logger.log(
        `[${tenantId}] WhatsApp confirmation sent successfully for CP-${shortOrderId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to send WhatsApp confirmation for order ${orderId}: ${err.message}`,
      );

      await this.prisma.notification
        .update({
          where: { id: notificationId },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            failReason: err.message,
          },
        })
        .catch(() => {}); // ignore if it wasn't created
    }
  }

  @OnEvent('order.rejected')
  async handleOrderRejected(payload: {
    tenantId: string;
    draftId: string;
    reason: string;
  }) {
    const { tenantId, draftId, reason } = payload;
    this.logger.log(
      `[${tenantId}] Sending WhatsApp rejection for draft ${draftId}`,
    );

    const notificationId = uuidv4();

    try {
      const draft = await this.prisma.aIDraftOrder.findUnique({
        where: { id: draftId, tenantId },
        include: { customer: true },
      });

      if (!draft || !draft.customer) {
        this.logger.error(
          `Draft or customer not found for rejection notification: ${draftId}`,
        );
        return;
      }

      const displayReason = reason ? `Reason: ${reason}` : 'No reason provided';
      const msg = `We're sorry, we're unable to process your order at this time. ${displayReason}. Please contact us directly for assistance.`;

      // 1. Create DB record
      await this.prisma.notification.create({
        data: {
          id: notificationId,
          tenantId,
          type: 'ORDER_REJECTED',
          channel: 'WHATSAPP',
          title: `Draft ${draftId.substring(0, 8)} Rejected`,
          message: msg,
          status: 'PENDING',
          metadata: { to: draft.customer.phone },
        },
      });

      // 2. Send via Adapter
      await this.whatsappAdapter.sendTextMessage(draft.customer.phone, msg);

      // 3. Update DB record to SENT
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'SENT', sentAt: new Date() },
      });

      // 4. Audit Log
      await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId,
          actorType: 'SYSTEM',
          action: 'NOTIFICATION_SENT',
          entityType: 'Notification',
          entityId: notificationId,
          afterState: { status: 'SENT', channel: 'WHATSAPP' },
        },
      });

      this.logger.log(
        `[${tenantId}] WhatsApp rejection sent successfully to customer ${draft.customer.phone}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to send WhatsApp rejection for draft ${draftId}: ${err.message}`,
      );

      await this.prisma.notification
        .update({
          where: { id: notificationId },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            failReason: err.message,
          },
        })
        .catch(() => {});
    }
  }
}
