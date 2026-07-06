import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { GeminiAdapter } from '../adapters/gemini.adapter';
import { AIProcessingStage } from '@prisma/client';

export interface RetrievedProduct {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: number;
  stockQuantity: number;
  attributes: Record<string, unknown> | null;
}

/**
 * ProductRetrieverService
 *
 * Stage 2 of the AI pipeline — RAG (Retrieval-Augmented Generation).
 *
 * Searches the tenant's product catalog using:
 * 1. Vector similarity search (pgvector) — semantic matching
 * 2. Fallback: text search if no embedding available
 *
 * Returns top matching products as formatted context for the entity extractor.
 * This prevents AI hallucination by grounding it in real catalog data.
 */
@Injectable()
export class ProductRetrieverService {
  private readonly logger = new Logger(ProductRetrieverService.name);
  private readonly TOP_K = 5; // Number of products to retrieve

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiAdapter,
  ) {}

  /**
   * Retrieve top-K products relevant to the customer's message.
   * Returns formatted context string for injection into AI prompt.
   */
  async retrieve(
    tenantId: string,
    messageId: string,
    messageText: string,
  ): Promise<{ products: RetrievedProduct[]; catalogContext: string }> {
    const startTime = Date.now();

    let products: RetrievedProduct[];

    try {
      // Try vector search first (requires pgvector + product embeddings)
      products = await this.vectorSearch(tenantId, messageText);

      if (products.length === 0) {
        // Fallback to text-based search
        products = await this.textSearch(tenantId, messageText);
      }
    } catch (error) {
      this.logger.warn(`Vector search failed, using text search: ${error}`);
      products = await this.textSearch(tenantId, messageText);
    }

    const processingTimeMs = Date.now() - startTime;
    const catalogContext = this.formatCatalogContext(products);

    // Log this AI processing stage
    await this.prisma.aIProcessingLog.create({
      data: {
        tenantId,
        messageId,
        stage: AIProcessingStage.PRODUCT_RETRIEVAL,
        inputData: { message: messageText, topK: this.TOP_K },
        outputData: {
          productsFound: products.length,
          productIds: products.map((p) => p.id),
        },
        modelUsed: 'text-embedding-004',
        promptVersion: '1.0.0',
        processingTimeMs,
        success: true,
      },
    });

    this.logger.log(
      `[${tenantId}] Retrieved ${products.length} catalog products in ${processingTimeMs}ms`,
    );

    return { products, catalogContext };
  }

  /**
   * Generate and store embedding for a product.
   * Called when a product is created or updated.
   */
  async generateAndStoreEmbedding(productId: string, tenantId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) return;

    const textToEmbed = [
      product.name,
      product.description ?? '',
      product.sku ?? '',
      JSON.stringify(product.attributes ?? {}),
    ]
      .filter(Boolean)
      .join(' | ');

    try {
      const embedding = await this.gemini.generateEmbedding(textToEmbed);

      // Store embedding using raw SQL (Prisma doesn't support vector type natively)
      await this.prisma.$executeRaw`
        UPDATE products
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${productId}::uuid AND tenant_id = ${tenantId}::uuid
      `;

      this.logger.log(`[${tenantId}] Embedding generated for product: ${product.name}`);
    } catch (error) {
      this.logger.error(`Failed to generate embedding for ${productId}: ${error}`);
    }
  }

  // ── Private methods ────────────────────────────────────────────

  private async vectorSearch(
    tenantId: string,
    query: string,
  ): Promise<RetrievedProduct[]> {
    const queryEmbedding = await this.gemini.generateEmbedding(query);

    // pgvector cosine similarity search
    const results = await this.prisma.$queryRaw<RetrievedProduct[]>`
      SELECT
        id,
        name,
        description,
        sku,
        price::float,
        stock_quantity as "stockQuantity",
        attributes,
        1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS similarity
      FROM products
      WHERE
        tenant_id = ${tenantId}::uuid
        AND is_active = true
        AND deleted_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
      LIMIT ${this.TOP_K}
    `;

    return results;
  }

  private async textSearch(
    tenantId: string,
    query: string,
  ): Promise<RetrievedProduct[]> {
    // Simple case-insensitive text search as fallback
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: this.TOP_K,
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      sku: p.sku,
      price: parseFloat(p.price.toString()),
      stockQuantity: p.stockQuantity,
      attributes: p.attributes as Record<string, unknown> | null,
    }));
  }

  private formatCatalogContext(products: RetrievedProduct[]): string {
    if (products.length === 0) {
      return 'No products found in catalog.';
    }

    return products
      .map(
        (p, i) =>
          `${i + 1}. ID: ${p.id}
   Name: ${p.name}
   SKU: ${p.sku ?? 'N/A'}
   Price: LKR ${p.price}
   Stock: ${p.stockQuantity} units
   Attributes: ${JSON.stringify(p.attributes ?? {})}
   Description: ${p.description ?? 'N/A'}`,
      )
      .join('\n\n');
  }
}
