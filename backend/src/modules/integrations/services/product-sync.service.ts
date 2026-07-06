import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { ProductRetrieverService } from '../../ai-engine/pipeline/product-retriever.service';
import { ECOMMERCE_ADAPTER } from '../interfaces/ecommerce-adapter.interface';
import type { IEcommerceAdapter } from '../interfaces/ecommerce-adapter.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ProductSyncService {
  private readonly logger = new Logger(ProductSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productRetriever: ProductRetrieverService,
    @Inject(ECOMMERCE_ADAPTER)
    private readonly adapter: IEcommerceAdapter,
  ) {}

  /**
   * Fetch all products from Ecommerce system and upsert into local DB.
   * Then trigger vector embeddings generation for AI RAG.
   */
  async syncProducts(tenantId: string) {
    this.logger.log(`[${tenantId}] Starting product sync`);

    const client = await this.adapter.initialize(tenantId);
    const products = await this.adapter.getProducts(client);

    let newCount = 0;
    let updateCount = 0;
    const embeddedIds: string[] = [];

    for (const p of products) {
      // Find existing product by external ID or name (fallback)
      const existing = await this.prisma.product.findFirst({
        where: {
          tenantId,
          OR: [
            { woocommerceId: p.externalId },
            // fallback for now if they have the exact same name
            { name: p.name },
          ],
        },
      });

      let productId = '';

      if (existing) {
        // Update
        await this.prisma.product.update({
          where: { id: existing.id },
          data: {
            woocommerceId: p.externalId, // Ensure it's set
            name: p.name,
            description: p.description,
            price: p.price,
            stockQuantity: p.stockQuantity,
            isActive: p.isActive,
            attributes: p.attributes as object,
          },
        });
        productId = existing.id;
        updateCount++;
      } else {
        // Create
        productId = uuidv4();
        await this.prisma.product.create({
          data: {
            id: productId,
            tenantId,
            woocommerceId: p.externalId,
            name: p.name,
            description: p.description,
            sku: p.externalId, // fallback sku
            price: p.price,
            stockQuantity: p.stockQuantity,
            isActive: p.isActive,
            attributes: p.attributes as object,
          },
        });
        newCount++;
      }

      embeddedIds.push(productId);
    }

    this.logger.log(`[${tenantId}] Product sync complete. New: ${newCount}, Updated: ${updateCount}`);

    // Generate embeddings in background so we don't block the API response
    // In production, this should be dispatched to a BullMQ queue
    this.logger.log(`[${tenantId}] Dispatching embedding generation for ${embeddedIds.length} products`);
    Promise.allSettled(
      embeddedIds.map((id) => this.productRetriever.generateAndStoreEmbedding(id, tenantId)),
    ).then((results) => {
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        this.logger.error(`[${tenantId}] Failed to generate embeddings for ${failures.length} products`);
      } else {
        this.logger.log(`[${tenantId}] Embeddings generated successfully`);
      }
    });

    return { success: true, newCount, updateCount, totalProcessed: products.length };
  }
}
