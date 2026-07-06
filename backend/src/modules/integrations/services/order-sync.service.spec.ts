import { OrderSyncService } from './order-sync.service';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  IEcommerceAdapter,
  EcommerceClient,
} from '../interfaces/ecommerce-adapter.interface';

/** A tx mock capturing all writes performed inside prisma.$transaction. */
function buildTx() {
  return {
    order: { update: jest.fn().mockResolvedValue({}) },
    inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
    product: { update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    notification: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('OrderSyncService', () => {
  const orderFindFirst = jest.fn();
  let tx: ReturnType<typeof buildTx>;

  const prisma = {
    order: { findFirst: orderFindFirst },
    $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;

  const initialize = jest.fn();
  const createOrder = jest.fn();
  const adapter = { initialize, getProducts: jest.fn(), createOrder } as IEcommerceAdapter;

  let service: OrderSyncService;

  const mockClient: EcommerceClient = { tenantId: 'tenant-1', isMock: true };

  const approvedOrder = {
    id: 'order-1',
    tenantId: 'tenant-1',
    orderNumber: 'ORD-1',
    status: 'APPROVED',
    woocommerceOrderId: null,
    aiConfidenceScore: 0.9,
    totalAmount: 3000,
    customerId: 'cust-1',
    customer: { name: 'Nimal', phone: '+94771234567' },
    items: [
      { id: 'i1', productId: 'p1', quantity: 2, unitPrice: 1500, product: { woocommerceId: '10' } },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx = buildTx();
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));
    service = new OrderSyncService(prisma, adapter);
  });

  it('syncs an approved order: persists external id, reduces inventory, audits', async () => {
    orderFindFirst.mockResolvedValue(approvedOrder);
    initialize.mockResolvedValue(mockClient);
    createOrder.mockResolvedValue({ success: true, externalOrderId: 'wc_555' });

    await service.handleOrderApproved({ tenantId: 'tenant-1', orderId: 'order-1' });

    // External id + syncedAt persisted with SYNCED status
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          status: 'SYNCED',
          woocommerceOrderId: 'wc_555',
          syncedAt: expect.any(Date),
        }),
      }),
    );

    // BR-14: inventory reduced only now, one OUT transaction per item + stock decrement
    expect(tx.inventoryTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'p1',
          type: 'OUT',
          quantity: -2,
          referenceOrderId: 'order-1',
        }),
      }),
    );
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: { stockQuantity: { decrement: 2 } },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ORDER_SYNCED' }) }),
    );
  });

  it('is idempotent: an already-synced order is skipped (no external call, no stock change)', async () => {
    orderFindFirst.mockResolvedValue({
      ...approvedOrder,
      status: 'SYNCED',
      woocommerceOrderId: 'wc_555',
    });

    await service.handleOrderApproved({ tenantId: 'tenant-1', orderId: 'order-1' });

    expect(initialize).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('marks the order FAILED and notifies the owner when sync fails', async () => {
    orderFindFirst.mockResolvedValue(approvedOrder);
    initialize.mockResolvedValue(mockClient);
    createOrder.mockResolvedValue({ success: false, error: 'store unreachable' });

    await service.handleOrderApproved({ tenantId: 'tenant-1', orderId: 'order-1' });

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Order Sync Failed' }),
      }),
    );
    // No inventory movement on failure.
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects real-provider sync when a product has no external mapping', async () => {
    orderFindFirst.mockResolvedValue({
      ...approvedOrder,
      items: [{ id: 'i1', productId: 'p1', quantity: 1, unitPrice: 1500, product: { woocommerceId: null } }],
    });
    initialize.mockResolvedValue({ tenantId: 'tenant-1', isMock: false });

    await service.handleOrderApproved({ tenantId: 'tenant-1', orderId: 'order-1' });

    // Should not attempt to create an order; should mark FAILED.
    expect(createOrder).not.toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } }),
    );
  });
});
