import { WooCommerceAdapter } from './woocommerce.adapter';
import { PrismaService } from '../../../common/database/prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import { CreateOrderPayload } from '../interfaces/ecommerce-adapter.interface';

describe('WooCommerceAdapter', () => {
  const findUnique = jest.fn();
  const prisma = { tenant: { findUnique } } as unknown as PrismaService;
  const encryption = {
    decrypt: jest.fn((v: string) => `dec(${v})`),
  } as unknown as EncryptionService;

  let adapter: WooCommerceAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new WooCommerceAdapter(prisma, encryption);
  });

  const payload = (idempotencyKey: string): CreateOrderPayload => ({
    orderNumber: 'ORD-1',
    customerId: 'cust-1',
    items: [{ externalProductId: '10', quantity: 2 }],
    idempotencyKey,
  });

  describe('multi-tenant isolation', () => {
    it('returns a distinct per-tenant client carrying the correct tenantId (no shared state)', async () => {
      findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          woocommerceProvider: 'MOCK',
          woocommerceUrl: null,
          woocommerceKey: null,
          woocommerceSecret: null,
          id: where.id,
        }),
      );

      const clientA = await adapter.initialize('tenant-A');
      const clientB = await adapter.initialize('tenant-B');

      expect(clientA.tenantId).toBe('tenant-A');
      expect(clientB.tenantId).toBe('tenant-B');
      expect(clientA).not.toBe(clientB);
      // The adapter itself holds no per-tenant state — proven by both clients coexisting.
    });
  });

  describe('mock mode', () => {
    beforeEach(() => {
      findUnique.mockResolvedValue({
        woocommerceProvider: 'MOCK',
        woocommerceUrl: null,
        woocommerceKey: null,
        woocommerceSecret: null,
      });
    });

    it('produces a deterministic external id from the idempotency key', async () => {
      const client = await adapter.initialize('tenant-A');
      const r1 = await adapter.createOrder(client, payload('order-123'));
      const r2 = await adapter.createOrder(client, payload('order-123'));

      expect(r1.success).toBe(true);
      expect(r1.externalOrderId).toBe('mock_wc_order-123');
      // Same idempotency key → same external id (retry-safe).
      expect(r2.externalOrderId).toBe(r1.externalOrderId);
    });

    it('does not touch the encryption service in mock mode', async () => {
      const client = await adapter.initialize('tenant-A');
      await adapter.getProducts(client);
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('real mode credential handling', () => {
    it('decrypts stored credentials before building the client', async () => {
      findUnique.mockResolvedValue({
        woocommerceProvider: 'WOOCOMMERCE',
        woocommerceUrl: 'https://store.example',
        woocommerceKey: 'enc-key',
        woocommerceSecret: 'enc-secret',
      });

      const client = await adapter.initialize('tenant-A');

      expect(client.isMock).toBe(false);
      expect(encryption.decrypt).toHaveBeenCalledWith('enc-key');
      expect(encryption.decrypt).toHaveBeenCalledWith('enc-secret');
    });

    it('throws when credentials are missing', async () => {
      findUnique.mockResolvedValue({
        woocommerceProvider: 'WOOCOMMERCE',
        woocommerceUrl: 'https://store.example',
        woocommerceKey: null,
        woocommerceSecret: null,
      });

      await expect(adapter.initialize('tenant-A')).rejects.toThrow(
        /credentials missing/,
      );
    });
  });
});
