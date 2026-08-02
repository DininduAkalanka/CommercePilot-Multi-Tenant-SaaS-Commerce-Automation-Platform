import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  MessageEvent,
} from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import {
  OrderStatus,
  AIDraftStatus,
  OrderSource,
  Prisma,
} from '@prisma/client';

/**
 * OrdersService
 *
 * Manages the order lifecycle:
 * WAITING_APPROVAL → APPROVED → SYNCED
 *                 ↘ REJECTED
 *
 * Architecture Rule: No WooCommerce calls here.
 * Integration is handled by IntegrationsModule via interface.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private readonly sse$ = new Subject<{
    tenantId: string;
    type: string;
    data: any;
  }>();

  /**
   * Get Server-Sent Events stream for a specific tenant.
   * Ensures data isolation by filtering by tenantId.
   */
  getSseObservable(tenantId: string): Observable<MessageEvent> {
    return this.sse$.asObservable().pipe(
      filter((event) => event.tenantId === tenantId),
      map((event) => ({
        data: JSON.stringify({ type: event.type, payload: event.data }),
      })),
    );
  }

  /**
   * Emit an event to the SSE stream.
   */
  emitSse(tenantId: string, type: string, data: any) {
    this.sse$.next({ tenantId, type, data });
  }

  /**
   * Listen to draft.created and broadcast it to the SSE stream.
   */
  @OnEvent('draft.created')
  async handleDraftCreated(payload: { tenantId: string; draftId: string }) {
    const { tenantId, draftId } = payload;
    try {
      const draft = await this.prisma.aIDraftOrder.findUnique({
        where: { id: draftId, tenantId },
        include: {
          customer: true,
          items: { include: { product: true } },
        },
      });
      if (draft) {
        this.emitSse(tenantId, 'DRAFT_CREATED', draft);
        this.logger.log(
          `[${tenantId}] Broadcasted DRAFT_CREATED SSE event for ${draftId}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to broadcast draft created SSE: ${err.message}`,
      );
    }
  }

  /**
   * Get all draft orders pending owner approval.
   */
  async getPendingDrafts(tenantId: string) {
    return this.prisma.aIDraftOrder.findMany({
      where: {
        tenantId,
        status: AIDraftStatus.PENDING,
        deletedAt: null,
      },
      include: {
        customer: true,
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a specific draft order with full AI extraction details.
   */
  async getDraftById(tenantId: string, draftId: string) {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: { id: draftId, tenantId, deletedAt: null },
      include: {
        customer: true,
        items: { include: { product: true } },
      },
    });

    if (!draft) {
      throw new NotFoundException(`Draft order ${draftId} not found`);
    }

    // Also fetch the AI processing logs for this order's message
    const aiLogs = draft.messageId
      ? await this.prisma.aIProcessingLog.findMany({
          where: { tenantId, messageId: draft.messageId },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // Also fetch conversation history (all messages in this conversation session)
    const message = draft.messageId
      ? await this.prisma.whatsAppMessage.findUnique({
          where: { id: draft.messageId },
        })
      : null;

    const conversationMessages = message?.conversationId
      ? await this.prisma.whatsAppMessage.findMany({
          where: { tenantId, conversationId: message.conversationId },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    return { draft, aiLogs, conversationMessages };
  }

  /**
   * Approve a draft order.
   * Creates an official Order record.
   * WooCommerce sync is triggered via event (IntegrationsModule).
   */
  async approveDraft(
    tenantId: string,
    draftId: string,
    reviewerUserId: string,
    notes?: string,
  ) {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: {
        id: draftId,
        tenantId,
        status: { in: [AIDraftStatus.PENDING, AIDraftStatus.REVIEWED] },
      },
      include: { items: true },
    });

    if (!draft) {
      throw new NotFoundException(
        `Draft order ${draftId} not found or already reviewed`,
      );
    }

    // Validate stock for all items
    await this.validateStock(tenantId, draft.items);

    // Create the official order + items in a transaction
    const orderId = uuidv4();
    const structuredData = draft.structuredData as any;

    // Calculate totalAmount from draft items
    const calculatedTotal = draft.items.reduce(
      (sum, item) => sum + Number(item.unitPrice ?? 0) * item.quantity,
      0,
    );

    // Determine if this is a system/AI auto-approval or human approval
    const isSystemApproval = reviewerUserId === 'SYSTEM';

    const order = await this.prisma.$transaction(async (tx) => {
      // Create the Order
      const order = await tx.order.create({
        data: {
          id: orderId,
          tenantId,
          customerId: draft.customerId,
          orderNumber: await this.generateOrderNumber(tenantId),
          status: OrderStatus.APPROVED,
          totalAmount: calculatedTotal,
          aiConfidenceScore: draft.overallConfidence,
          source: OrderSource.WHATSAPP,
          deliveryAddress: structuredData?.delivery_info?.address,
          requestedDate: structuredData?.delivery_info?.requested_date
            ? new Date(structuredData.delivery_info.requested_date)
            : null,
          notes,
          reviewedByUserId: isSystemApproval ? null : reviewerUserId,
          reviewedAt: new Date(),
          aiDraftOrderId: draft.id,
          items: {
            create: draft.items.map((item) => ({
              id: uuidv4(),
              tenantId,
              productId: item.productId!,
              quantity: item.quantity,
              unitPrice: item.unitPrice ?? 0,
              subtotal: Number(item.unitPrice ?? 0) * item.quantity,
              selectedAttributes: item.selectedAttributes as object,
            })),
          },
        },
        include: { items: true, customer: true },
      });

      // Update draft status
      await tx.aIDraftOrder.update({
        where: { id: draftId },
        data: { status: AIDraftStatus.APPROVED },
      });

      // Update customer order count and lifetime value
      await tx.customer.update({
        where: { id: draft.customerId },
        data: {
          totalOrders: { increment: 1 },
          lifetimeValue: { increment: calculatedTotal },
        },
      });

      // NOTE (BR-14): inventory is NOT reduced here. Stock is deducted exactly
      // once, only after the order is successfully synchronized to the
      // e-commerce system — see OrderSyncService.handleOrderApproved. Reducing
      // it on approval too would double-count stock and would wrongly deplete
      // inventory for orders whose sync later fails.

      // Audit log
      await tx.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId,
          actorUserId: isSystemApproval ? null : reviewerUserId,
          actorType: isSystemApproval ? 'AI' : 'USER',
          action: 'ORDER_APPROVED',
          entityType: 'Order',
          entityId: orderId,
          afterState: {
            orderId,
            status: 'APPROVED',
            draftId,
            totalAmount: calculatedTotal,
            approvedBy: isSystemApproval ? 'AUTO_APPROVE' : reviewerUserId,
          },
        },
      });

      return order;
    });

    this.logger.log(
      `[${tenantId}] Order approved: ${order.orderNumber} (${orderId})`,
    );

    // Emit event so IntegrationsModule can sync to WooCommerce
    this.eventEmitter.emit('order.approved', { tenantId, orderId });

    return order;
  }

  /**
   * Reject a draft order with a reason.
   */
  async rejectDraft(
    tenantId: string,
    draftId: string,
    reviewerUserId: string,
    reason: string,
  ) {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: {
        id: draftId,
        tenantId,
        status: { in: [AIDraftStatus.PENDING, AIDraftStatus.REVIEWED] },
      },
    });

    if (!draft) {
      throw new NotFoundException(
        `Draft order ${draftId} not found or already reviewed`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aIDraftOrder.update({
        where: { id: draftId },
        data: { status: AIDraftStatus.REJECTED },
      });

      await tx.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId,
          actorUserId: reviewerUserId,
          actorType: 'USER',
          action: 'ORDER_REJECTED',
          entityType: 'AIDraftOrder',
          entityId: draftId,
          afterState: { draftId, status: 'REJECTED', reason },
        },
      });
    });

    this.logger.log(`[${tenantId}] Draft order rejected: ${draftId}`);

    // Emit event so WhatsAppNotificationListener can notify customer
    this.eventEmitter.emit('order.rejected', { tenantId, draftId, reason });

    return { success: true, message: 'Order rejected' };
  }

  /**
   * Get all confirmed orders with filtering.
   */
  async getOrders(
    tenantId: string,
    filters: { status?: OrderStatus; page?: number; limit?: number },
  ) {
    const { status, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, status, deletedAt: null },
        include: {
          customer: true,
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({
        where: { tenantId, status, deletedAt: null },
      }),
    ]);

    return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Dashboard stats — today's KPIs.
   */
  async getDashboardStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalOrders, pendingApproval, approvedToday, rejectedToday] =
      await Promise.all([
        this.prisma.order.count({ where: { tenantId, deletedAt: null } }),
        this.prisma.aIDraftOrder.count({
          where: { tenantId, status: AIDraftStatus.PENDING },
        }),
        this.prisma.order.count({
          where: {
            tenantId,
            status: { in: [OrderStatus.APPROVED, OrderStatus.SYNCED] },
            createdAt: { gte: today },
          },
        }),
        this.prisma.aIDraftOrder.count({
          where: {
            tenantId,
            status: AIDraftStatus.REJECTED,
            createdAt: { gte: today },
          },
        }),
      ]);

    return { totalOrders, pendingApproval, approvedToday, rejectedToday };
  }

  /**
   * Dashboard recent activity feed.
   */
  async getRecentActivity(tenantId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    return logs.map((log) => {
      let text = `Action: ${log.action}`;
      if (log.action === 'ORDER_APPROVED')
        text = `Order approved (${log.entityId})`;
      else if (log.action === 'ORDER_REJECTED')
        text = `Order rejected (${log.entityId})`;
      else if (log.action === 'AI_CORRECTION_RECORDED')
        text = `AI Draft corrected by human`;

      return {
        id: log.id,
        text,
        createdAt: log.timestamp,
      };
    });
  }

  /**
   * Analytics data for the analytics dashboard.
   *
   * Returns:
   * - dailyOrders: order counts for the past 30 days (for line chart)
   * - statusBreakdown: count per OrderStatus (for pie/donut chart)
   * - totalRevenue: sum of all approved order amounts
   * - aiConfidenceAvg: average AI confidence score across all drafts
   * - approvalRate: % of drafts that were approved vs. total reviewed
   *
   * Performance: Uses parallel queries, no N+1.
   */
  async getAnalytics(tenantId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Fetch all required data in parallel
    const [ordersLast30Days, allOrders, allDrafts] = await Promise.all([
      // All orders in last 30 days with createdAt for grouping
      this.prisma.order.findMany({
        where: { tenantId, deletedAt: null, createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
      // All orders for status breakdown and revenue
      this.prisma.order.findMany({
        where: { tenantId, deletedAt: null },
        select: { status: true, totalAmount: true },
      }),
      // All draft orders for AI confidence analysis
      this.prisma.aIDraftOrder.findMany({
        where: { tenantId, deletedAt: null },
        select: { overallConfidence: true, status: true },
      }),
    ]);

    // Build daily order count map (last 30 days)
    const dailyMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      d.setHours(0, 0, 0, 0);
      dailyMap.set(d.toISOString().split('T')[0], 0);
    }

    for (const order of ordersLast30Days) {
      const key = order.createdAt.toISOString().split('T')[0];
      if (dailyMap.has(key)) {
        dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      }
    }

    const dailyOrders = Array.from(dailyMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    // Status breakdown
    const statusBreakdown = Object.values(OrderStatus).reduce<
      Record<string, number>
    >((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});
    for (const order of allOrders) {
      statusBreakdown[order.status] = (statusBreakdown[order.status] ?? 0) + 1;
    }

    const totalRevenue = allOrders
      .filter((o) =>
        (
          [
            OrderStatus.APPROVED,
            OrderStatus.SYNCED,
            OrderStatus.CANCELLED,
          ] as OrderStatus[]
        ).includes(o.status),
      )
      .reduce((sum, o) => sum + Number(o.totalAmount), 0);

    // AI confidence average
    const confidenceValues = allDrafts.map((d) => d.overallConfidence);
    const aiConfidenceAvg =
      confidenceValues.length > 0
        ? confidenceValues.reduce((sum, c) => sum + c, 0) /
          confidenceValues.length
        : 0;

    // Approval rate
    const reviewedDrafts = allDrafts.filter((d) =>
      ['APPROVED', 'REJECTED'].includes(d.status),
    );
    const approvedDrafts = allDrafts.filter((d) => d.status === 'APPROVED');
    const approvalRate =
      reviewedDrafts.length > 0
        ? approvedDrafts.length / reviewedDrafts.length
        : 0;

    return {
      dailyOrders,
      statusBreakdown,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      aiConfidenceAvg: Number((aiConfidenceAvg * 100).toFixed(1)),
      approvalRate: Number((approvalRate * 100).toFixed(1)),
      totalOrders: allOrders.length,
      totalDrafts: allDrafts.length,
    };
  }

  // ── Private helpers ────────────────────────────────────────────

  private async validateStock(
    tenantId: string,
    items: Array<{ productId: string | null; quantity: number }>,
  ): Promise<void> {
    const productIds = items
      .map((item) => item.productId)
      .filter((id): id is string => id !== null);

    if (productIds.length === 0) return;

    // Batch query all products at once (avoids N+1)
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId,
        deletedAt: null,
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of items) {
      if (!item.productId) continue;

      const product = productMap.get(item.productId);

      if (!product) {
        throw new BadRequestException(`Product not found: ${item.productId}`);
      }

      if (product.stockQuantity < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}". ` +
            `Available: ${product.stockQuantity}, Requested: ${item.quantity}`,
        );
      }
    }
  }

  private async generateOrderNumber(tenantId: string): Promise<string> {
    const count = await this.prisma.order.count({ where: { tenantId } });
    const year = new Date().getFullYear();
    return `ORD-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Record owner corrections to an AI draft order.
   *
   * Phase 2 — AI Correction Logging (training signal).
   * Stores the diff between what the AI extracted and what the owner corrected.
   * This data is used for future model fine-tuning and evaluation.
   *
   * Architecture Rule: This is the only method that writes to humanCorrections.
   * The AuditLog record is immutable.
   */
  async saveDraftCorrections(
    tenantId: string,
    draftId: string,
    correctedData: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: { id: draftId, tenantId, deletedAt: null },
    });

    if (!draft) {
      throw new NotFoundException(`Draft order not found: ${draftId}`);
    }

    if (
      draft.status !== AIDraftStatus.PENDING &&
      draft.status !== AIDraftStatus.REVIEWED
    ) {
      throw new BadRequestException(
        `Cannot correct a draft in status: ${draft.status}. Only PENDING or REVIEWED drafts can be corrected.`,
      );
    }

    // Build correction diff: compare original AI extraction vs. owner's corrections
    const originalData = draft.structuredData as Record<string, unknown>;
    const fieldsCorrected = this.computeCorrectedFields(
      originalData,
      correctedData,
    );

    const corrections = {
      originalAiExtraction: originalData,
      ownerCorrections: correctedData,
      fieldsCorrected,
      correctedAt: new Date().toISOString(),
    };

    // Update the draft and items in a single transaction
    await this.prisma.$transaction(async (tx) => {
      // 1. Remove the previous (pre-correction) draft items. AIDraftOrderItem
      // rows are the mutable working set for an in-progress draft — not the
      // audit record. The audit trail survives via the immutable AuditLog
      // entry (step 4) plus AIDraftOrder.humanCorrections, both of which keep
      // the original AI extraction. Leaving stale items in place instead of
      // deleting them would make approveDraft() validate BOTH the old and
      // corrected items, rejecting the corrected order over the discarded one.
      await tx.aIDraftOrderItem.deleteMany({
        where: { draftOrderId: draftId, tenantId },
      });

      // 2. Create new draft items
      const itemsList = (correctedData.items as any[]) || [];
      for (const item of itemsList) {
        const productId = item.matched_product_id || item.productId || null;
        let unitPrice = item.unitPrice || item.unit_price || null;

        if (productId && !unitPrice) {
          const product = await tx.product.findUnique({
            where: { id: productId },
          });
          if (product) {
            unitPrice = product.price;
          }
        }

        await tx.aIDraftOrderItem.create({
          data: {
            id: uuidv4(),
            tenantId,
            draftOrderId: draftId,
            productId,
            productQuery: item.product_query || item.productQuery || '',
            matchedProductName:
              item.matched_product_name || item.matchedProductName || null,
            matchConfidence:
              item.match_confidence || item.matchConfidence || 1.0,
            quantity: item.quantity ?? 1,
            unitPrice: unitPrice,
            selectedAttributes: (item.selected_attributes ||
              item.selectedAttributes ||
              {}) as object,
          },
        });
      }

      // 3. Update the draft order working copy and status
      await tx.aIDraftOrder.update({
        where: { id: draftId },
        data: {
          humanCorrections: corrections as unknown as Prisma.InputJsonValue,
          correctedByUserId: userId,
          correctedAt: new Date(),
          status: AIDraftStatus.REVIEWED,
          // Update working copy
          structuredData: correctedData as unknown as Prisma.InputJsonValue,
        },
      });

      // 4. Write immutable audit log
      await tx.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId,
          actorUserId: userId,
          actorType: 'USER',
          action: 'AI_CORRECTION_RECORDED',
          entityType: 'AIDraftOrder',
          entityId: draftId,
          beforeState: {
            structuredData: originalData,
          } as unknown as Prisma.InputJsonValue,
          afterState: {
            structuredData: correctedData,
            fieldsCorrected,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    this.logger.log(
      `[${tenantId}] Draft ${draftId} corrected by user ${userId}. Fields changed: ${fieldsCorrected.join(', ') || 'none'}`,
    );
  }

  /**
   * Compute a flat list of field paths that differ between original and corrected data.
   * Provides a quick summary of what the owner changed (e.g. ["items[0].quantity", "delivery_info.address"]).
   */
  private computeCorrectedFields(
    original: Record<string, unknown>,
    corrected: Record<string, unknown>,
  ): string[] {
    const changed: string[] = [];

    const compare = (orig: unknown, corr: unknown, path: string) => {
      if (JSON.stringify(orig) !== JSON.stringify(corr)) {
        changed.push(path);
      }
    };

    // Top-level keys
    const allKeys = new Set([
      ...Object.keys(original),
      ...Object.keys(corrected),
    ]);
    for (const key of allKeys) {
      compare(original[key], corrected[key], key);
    }

    return changed;
  }

  /**
   * Listen for auto-approval events from AiEngineService.
   * Phase 2 — Confidence-Based Auto-Routing
   */
  @OnEvent('draft.auto_approve')
  async handleAutoApproveEvent(payload: { tenantId: string; draftId: string }) {
    this.logger.log(
      `[${payload.tenantId}] Auto-approving draft order ${payload.draftId}`,
    );
    try {
      // We use 'SYSTEM' as the reviewerUserId to indicate AI auto-approval
      await this.approveDraft(payload.tenantId, payload.draftId, 'SYSTEM');
    } catch (error) {
      this.logger.error(
        `[${payload.tenantId}] Auto-approve failed for draft ${payload.draftId}: ${error.message}`,
      );
    }
  }
}
