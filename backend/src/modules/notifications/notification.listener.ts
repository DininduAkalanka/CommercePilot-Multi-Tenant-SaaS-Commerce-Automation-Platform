import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../common/database/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent('draft.created')
  async handleDraftCreated(payload: { tenantId: string; draftId: string }) {
    const { tenantId, draftId } = payload;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      const owner = await this.prisma.user.findFirst({
        where: { tenantId, role: 'OWNER' },
      });

      if (!tenant || !owner) return;

      const draft = await this.prisma.aIDraftOrder.findUnique({
        where: { id: draftId },
      });

      if (!draft) return;

      // Ensure we don't send emails for auto-approved drafts (they happen too fast anyway, but just in case)
      if (draft.status !== 'PENDING') return;

      const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard/orders/${draftId}`;
      const shortDraftId = draftId.substring(0, 8);

      await this.notificationsService.sendOrderPendingApprovalEmail(
        tenantId,
        owner.email,
        `Draft-CP-${shortDraftId}`,
        dashboardUrl,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to send draft.created notification: ${err.message}`,
      );
    }
  }

  /**
   * A conversation the AI could not resolve has been escalated.
   *
   * This is time-critical in a way the other notifications are not: a customer
   * has just been told a human will reply, and they are waiting in the chat.
   * The email exists so the owner finds out without watching the dashboard.
   */
  @OnEvent('conversation.handoff_requested')
  async handleHandoffRequested(payload: {
    tenantId: string;
    phone: string;
    reason: string;
    customerMessage?: string;
    missingFields?: string[];
  }) {
    const { tenantId, phone, reason, customerMessage, missingFields } = payload;

    try {
      const owner = await this.prisma.user.findFirst({
        where: { tenantId, role: 'OWNER' },
      });
      if (!owner) return;

      await this.notificationsService.sendHandoffRequestedEmail(
        tenantId,
        owner.email,
        {
          phone,
          reason,
          customerMessage,
          missingFields,
          conversationUrl: `${process.env.FRONTEND_URL}/dashboard/simulator`,
        },
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to send conversation.handoff_requested notification: ${err.message}`,
      );
    }
  }

  @OnEvent('order.sync_failed')
  async handleOrderSyncFailed(payload: {
    tenantId: string;
    orderId: string;
    error: string;
  }) {
    const { tenantId, orderId, error } = payload;
    try {
      const owner = await this.prisma.user.findFirst({
        where: { tenantId, role: 'OWNER' },
      });

      if (!owner) return;

      const shortOrderId = orderId.substring(0, 8);

      await this.notificationsService.sendOrderSyncFailedEmail(
        tenantId,
        owner.email,
        `CP-${shortOrderId}`,
        error,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to send order.sync_failed notification: ${err.message}`,
      );
    }
  }
}
