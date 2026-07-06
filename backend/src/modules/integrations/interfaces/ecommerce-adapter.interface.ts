export const ECOMMERCE_ADAPTER = Symbol('ECOMMERCE_ADAPTER');

/**
 * Standardized product format returned from an Ecommerce provider.
 */
export interface SyncProduct {
  externalId: string;
  name: string;
  description?: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  categories: string[];
  attributes: Record<string, string[]>;
  imageUrl?: string;
}

/**
 * The standard payload we send to an Ecommerce provider to create an order.
 */
export interface CreateOrderPayload {
  orderNumber: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  items: Array<{
    externalProductId: string;
    quantity: number;
    price?: number;
  }>;
  totalAmount?: number;
  notes?: string;
  /**
   * Idempotency key. Providers/adapters must use this to guarantee that a
   * retried create request never produces a duplicate order (BR-15 / BR-18).
   */
  idempotencyKey: string;
}

/**
 * Standardized response after creating an order.
 */
export interface CreateOrderResult {
  success: boolean;
  externalOrderId?: string;
  error?: string;
}

/**
 * Opaque, per-tenant connection context returned by {@link IEcommerceAdapter.initialize}.
 *
 * IMPORTANT (multi-tenant safety): the adapter itself is a stateless singleton.
 * All tenant-specific connection state lives on this client object, which is
 * created per call. This prevents one tenant's credentials from leaking into
 * another tenant's request under concurrency.
 */
export interface EcommerceClient {
  readonly tenantId: string;
  readonly isMock: boolean;
}

/**
 * Abstract interface that all Ecommerce providers (WooCommerce, Shopify) must implement.
 *
 * The interface is intentionally stateless: `initialize` builds a per-tenant
 * client which is then passed explicitly to the operations.
 */
export interface IEcommerceAdapter {
  /**
   * Build a per-tenant client from decrypted tenant credentials.
   */
  initialize(tenantId: string): Promise<EcommerceClient>;

  /**
   * Fetch all products from the provider using the given client.
   */
  getProducts(client: EcommerceClient): Promise<SyncProduct[]>;

  /**
   * Create an order in the provider's system using the given client.
   */
  createOrder(
    client: EcommerceClient,
    payload: CreateOrderPayload,
  ): Promise<CreateOrderResult>;
}
