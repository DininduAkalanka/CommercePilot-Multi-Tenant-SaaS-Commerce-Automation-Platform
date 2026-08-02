import { Injectable, Logger } from '@nestjs/common';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import {
  IEcommerceAdapter,
  EcommerceClient,
  SyncProduct,
  CreateOrderPayload,
  CreateOrderResult,
} from '../interfaces/ecommerce-adapter.interface';
import { PrismaService } from '../../../common/database/prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import { EcommerceProvider } from '@prisma/client';

/**
 * Minimal typed surface of the WooCommerce REST client we depend on.
 * Keeps the adapter free of `any` while tolerating the library's loose types.
 */
interface WooRestClient {
  get(
    endpoint: string,
    params?: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
  post(
    endpoint: string,
    data: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
}

/** Per-tenant WooCommerce client — all connection state lives here, not on the singleton adapter. */
interface WooCommerceClient extends EcommerceClient {
  readonly api: WooRestClient | null;
}

// Shapes of the subset of WooCommerce API responses we read.
interface WooProduct {
  id: number;
  name: string;
  short_description?: string;
  description?: string;
  price?: string;
  regular_price?: string;
  stock_quantity?: number | null;
  status?: string;
  categories?: Array<{ name: string }>;
  attributes?: Array<{ name: string; options: string[] }>;
  images?: Array<{ src: string }>;
}

interface WooOrderResponse {
  id: number;
}

@Injectable()
export class WooCommerceAdapter implements IEcommerceAdapter {
  private readonly logger = new Logger(WooCommerceAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async initialize(tenantId: string): Promise<EcommerceClient> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        woocommerceProvider: true,
        woocommerceUrl: true,
        woocommerceKey: true,
        woocommerceSecret: true,
      },
    });

    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    if (tenant.woocommerceProvider === EcommerceProvider.MOCK) {
      this.logger.log(`Initialized in MOCK mode for tenant ${tenantId}`);
      const client: WooCommerceClient = { tenantId, isMock: true, api: null };
      return client;
    }

    if (
      !tenant.woocommerceUrl ||
      !tenant.woocommerceKey ||
      !tenant.woocommerceSecret
    ) {
      throw new Error(`WooCommerce credentials missing for tenant ${tenantId}`);
    }

    // Credentials are encrypted at rest — decrypt only here, in the adapter.
    const consumerKey = this.encryption.decrypt(tenant.woocommerceKey);
    const consumerSecret = this.encryption.decrypt(tenant.woocommerceSecret);

    // The library ships as both default and named export depending on version/bundler.
    const ApiClass =
      (WooCommerceRestApi as unknown as { default?: typeof WooCommerceRestApi })
        .default ?? WooCommerceRestApi;
    const api = new ApiClass({
      url: tenant.woocommerceUrl,
      consumerKey,
      consumerSecret,
      version: 'wc/v3',
      queryStringAuth: true,
    }) as unknown as WooRestClient;

    this.logger.log(`Initialized WooCommerce API for tenant ${tenantId}`);
    const client: WooCommerceClient = { tenantId, isMock: false, api };
    return client;
  }

  async getProducts(client: EcommerceClient): Promise<SyncProduct[]> {
    const woo = this.asWooClient(client);

    if (woo.isMock) {
      return this.getMockProducts();
    }
    if (!woo.api) {
      throw new Error('WooCommerce client not initialized');
    }

    try {
      // NOTE: fetches the first page (100 products). Full pagination is a
      // follow-up; logged so partial syncs are never silent.
      const response = await woo.api.get('products', { per_page: 100 });
      const wcProducts = (response.data as WooProduct[]) ?? [];

      if (wcProducts.length === 100) {
        this.logger.warn(
          `[${woo.tenantId}] WooCommerce returned a full page (100). Additional products beyond page 1 were not synced.`,
        );
      }

      return wcProducts.map((p) => this.mapProduct(p));
    } catch (error) {
      this.logger.error(
        `[${woo.tenantId}] Failed to fetch WooCommerce products: ${this.errorMessage(error)}`,
      );
      throw error;
    }
  }

  async createOrder(
    client: EcommerceClient,
    payload: CreateOrderPayload,
  ): Promise<CreateOrderResult> {
    const woo = this.asWooClient(client);

    if (woo.isMock) {
      this.logger.log(`[MOCK] Creating order ${payload.orderNumber}`);
      // Deterministic mock id derived from the idempotency key so repeated
      // mock calls for the same order return the same external id.
      return {
        success: true,
        externalOrderId: `mock_wc_${payload.idempotencyKey}`,
      };
    }
    if (!woo.api) {
      throw new Error('WooCommerce client not initialized');
    }

    try {
      const data: Record<string, unknown> = {
        payment_method: 'bacs',
        payment_method_title: 'Direct Bank Transfer',
        set_paid: false,
        billing: {
          first_name: payload.customerName || 'WhatsApp',
          last_name: 'Customer',
          phone: payload.customerPhone || '',
        },
        line_items: payload.items.map((item) => ({
          product_id: parseInt(item.externalProductId, 10),
          quantity: item.quantity,
        })),
        customer_note: payload.notes || '',
        // Persist the idempotency key on the order so the same CommercePilot
        // order is never duplicated in WooCommerce across retries.
        meta_data: [
          {
            key: '_commercepilot_idempotency_key',
            value: payload.idempotencyKey,
          },
          { key: '_commercepilot_order_number', value: payload.orderNumber },
        ],
      };

      const response = await woo.api.post('orders', data);
      const order = response.data as WooOrderResponse;

      this.logger.log(
        `[${woo.tenantId}] WooCommerce order created: ${order.id}`,
      );
      return { success: true, externalOrderId: String(order.id) };
    } catch (error) {
      this.logger.error(
        `[${woo.tenantId}] Failed to create WooCommerce order: ${this.errorMessage(error)}`,
      );
      return { success: false, error: this.errorMessage(error) };
    }
  }

  /**
   * Narrow a generic EcommerceClient to this adapter's concrete client.
   * Safe because this adapter is the only producer of the client (initialize).
   */
  private asWooClient(client: EcommerceClient): WooCommerceClient {
    return client as WooCommerceClient;
  }

  private mapProduct(p: WooProduct): SyncProduct {
    const attributes: Record<string, string[]> = {};
    for (const attr of p.attributes ?? []) {
      attributes[attr.name] = attr.options;
    }

    return {
      externalId: String(p.id),
      name: p.name,
      description: p.short_description || p.description,
      price: parseFloat(p.price || p.regular_price || '0'),
      stockQuantity: p.stock_quantity ?? 100, // default when store isn't managing stock
      isActive: p.status === 'publish',
      categories: (p.categories ?? []).map((c) => c.name),
      attributes,
      imageUrl: p.images?.[0]?.src,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getMockProducts(): SyncProduct[] {
    return [
      {
        externalId: 'mock_1',
        name: 'White School Shirt (Mock)',
        description: 'Standard white uniform shirt',
        price: 1500,
        stockQuantity: 50,
        isActive: true,
        categories: ['Uniforms'],
        attributes: { size: ['S', 'M', 'L'], color: ['white'] },
      },
      {
        externalId: 'mock_2',
        name: 'Blue School Trousers (Mock)',
        description: 'Standard blue uniform trousers',
        price: 2500,
        stockQuantity: 30,
        isActive: true,
        categories: ['Uniforms'],
        attributes: { size: ['28', '30', '32'], color: ['blue'] },
      },
    ];
  }
}
