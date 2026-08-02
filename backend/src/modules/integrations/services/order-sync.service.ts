import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../common/database/prisma.service';
import { ECOMMERCE_ADAPTER } from '../interfaces/ecommerce-adapter.interface';
import type {
  IEcommerceAdapter,
  CreateOrderPayload,
} from '../interfaces/ecommerce-adapter.interface';
import {
  OrderStatus,
  NotificationType,
  NotificationChannel,
  InventoryTxType,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ECOMMERCE_ADAPTER)
    private readonly adapter: IEcommerceAdapter,
  ) {}

  /**
   * Listen for approved orders and push them to the Ecommerce system.
   *
   * Business rules enforced here:
   *  - BR-15 / BR-18: idempotent — never create a duplicate external order.
   *  - BR-14: inventory is reduced only after approval AND successful sync.
   *  - BR-21: failures are never swallowed — order is marked FAILED, owner notified.
   */
  @OnEvent('order.approved')
  async handleOrderApproved(payload: { tenantId: string; orderId: string }) {
    const { tenantId, orderId } = payload;
    this.logger.log(
      `[${tenantId}] Starting sync for approved order ${orderId}`,
    );

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      include: {
        items: { include: { product: true } },
        customer: true,
      },
    });

    if (!order) {
      this.logger.error(`[${tenantId}] Order ${orderId} not found`);
      return;
    }

    // ── Idempotency guard (BR-15 / BR-18) ────────────────────────────
    // If this order already carries an external id or is already SYNCED,
    // a duplicate event (retry / double-approve) must be a no-op.
    if (order.woocommerceOrderId || order.status === OrderStatus.SYNCED) {
      this.logger.warn(
        `[${tenantId}] Order ${orderId} already synced (ext=${order.woocommerceOrderId}). Skipping.`,
      );
      return;
    }

    try {
      // ── Initialize a per-tenant client (no shared adapter state) ────
      const client = await this.adapter.initialize(tenantId);

      // ── Validate external product mapping for real providers ───────
      if (!client.isMock) {
        const unmapped = order.items.filter((i) => !i.product?.woocommerceId);
        if (unmapped.length > 0) {
          throw new Error(
            `${unmapped.length} order item(s) have no WooCommerce product id — run a product sync first.`,
          );
        }
      }

      const orderPayload: CreateOrderPayload = {
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        customerName: order.customer?.name || 'WhatsApp Customer',
        customerPhone: order.customer?.phone || '',
        items: order.items.map((item) => ({
          externalProductId: item.product?.woocommerceId || '',
          quantity: item.quantity,
          price: Number(item.unitPrice),
        })),
        totalAmount: Number(order.totalAmount),
        notes: `Created via CommercePilot (AI Confidence: ${order.aiConfidenceScore})`,
        // Stable per-order key → the adapter guarantees no duplicate external order.
        idempotencyKey: order.id,
      };

      const result = await this.adapter.createOrder(client, orderPayload);

      if (!result.success) {
        throw new Error(result.error || 'Unknown sync error');
      }

      // ── Success: persist external id, reduce inventory, audit ──────
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.SYNCED,
            woocommerceOrderId: result.externalOrderId,
            syncedAt: new Date(),
          },
        });

        // BR-14: reduce stock only now. One inventory transaction per line item.
        for (const item of order.items) {
          await tx.inventoryTransaction.create({
            data: {
              id: uuidv4(),
              tenantId,
              productId: item.productId,
              type: InventoryTxType.OUT,
              quantity: -Math.abs(item.quantity), // negative = OUT
              referenceOrderId: orderId,
              notes: `Order ${order.orderNumber} synced to WooCommerce`,
            },
          });
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { decrement: item.quantity } },
          });
        }

        await tx.auditLog.create({
          data: {
            id: uuidv4(),
            tenantId,
            actorType: 'SYSTEM',
            action: 'ORDER_SYNCED',
            entityType: 'Order',
            entityId: orderId,
            beforeState: { status: order.status },
            afterState: {
              status: OrderStatus.SYNCED,
              externalOrderId: result.externalOrderId,
            },
          },
        });
      });

      this.logger.log(
        `[${tenantId}] Order ${orderId} synced successfully (Ext ID: ${result.externalOrderId})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${tenantId}] Failed to sync order ${orderId}: ${message}`,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.FAILED },
        });

        await tx.auditLog.create({
          data: {
            id: uuidv4(),
            tenantId,
            actorType: 'SYSTEM',
            action: 'ORDER_SYNC_FAILED',
            entityType: 'Order',
            entityId: orderId,
            afterState: {
              status: OrderStatus.FAILED,
              error: message,
            },
          },
        });

        await tx.notification.create({
          data: {
            id: uuidv4(),
            tenantId,
            type: NotificationType.SYSTEM_ALERT,
            channel: NotificationChannel.SYSTEM,
            title: 'Order Sync Failed',
            message: `Failed to sync order to WooCommerce: ${message}`,
          },
        });
      });
    }
  }
}
