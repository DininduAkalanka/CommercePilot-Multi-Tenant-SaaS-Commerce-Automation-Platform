import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { AI_ADAPTER } from '../adapters/ai-adapter.interface';
import type { AiAdapter } from '../adapters/ai-adapter.interface';
import { EMBEDDING_PROVIDER } from '../adapters/embedding-provider.interface';
import { ProductVariantService } from '../../products/product-variant.service';
import type { EmbeddingProvider } from '../adapters/embedding-provider.interface';
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

  /**
   * Cosine-similarity floor for vector search (0..1). Below this a product is
   * treated as irrelevant rather than being offered to the LLM as grounding.
   */
  private readonly MIN_SIMILARITY = Number(
    process.env.RAG_MIN_SIMILARITY ?? '0.5',
  );

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_ADAPTER) private readonly ai: AiAdapter,
    // Separate from the LLM: embeddings and text generation come from
    // different vendors, and the text provider may have no embedding models.
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
    private readonly variants: ProductVariantService,
  ) {}

  /**
   * Retrieve top-K products relevant to the customer's message.
   * Returns formatted context string for injection into AI prompt.
   */
  async retrieve(
    tenantId: string,
    messageId: string,
    messageText: string,
    referralHint?: string | null,
  ): Promise<{ products: RetrievedProduct[]; catalogContext: string }> {
    const startTime = Date.now();

    // A customer who tapped an ad often says only "mata meka one" ("I want
    // this") — obvious to them, unmatchable on its own. Appending the ad's own
    // headline gives retrieval something to match, without discarding what the
    // customer actually said (they may have specified a size or colour).
    const searchText = referralHint
      ? `${messageText} ${referralHint}`.trim()
      : messageText;

    if (referralHint) {
      this.logger.log(
        `[${tenantId}] Using referral hint for retrieval: "${referralHint.slice(0, 60)}"`,
      );
    }

    let products: RetrievedProduct[];

    // Recorded so the metrics dashboard reports what actually ran. This used
    // to log a hardcoded 'text-embedding-004' regardless — a model that is
    // now retired and, with no embedding provider configured, never called.
    // A dashboard naming a model that did not run misleads exactly the
    // debugging it exists to support.
    let searchMethod = 'vector-search';

    try {
      // Try vector search first (requires pgvector + product embeddings)
      products = await this.vectorSearch(tenantId, searchText);

      if (products.length === 0) {
        // Fallback to text-based search
        products = await this.textSearch(tenantId, searchText);
        searchMethod = 'text-search';
      }
    } catch (error) {
      this.logger.warn(`Vector search failed, using text search: ${error}`);
      products = await this.textSearch(tenantId, searchText);
      searchMethod = 'text-search-after-vector-error';
    }

    const processingTimeMs = Date.now() - startTime;
    // PR3: quote the same stock the validator will enforce.
    products = await this.applyVariantStock(tenantId, products);
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
        modelUsed: searchMethod,
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
  async generateAndStoreEmbedding(
    productId: string,
    tenantId: string,
  ): Promise<void> {
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
      const embedding = await this.embeddings.generateEmbedding(textToEmbed);

      if (embedding === null) {
        // No embedding available (no API key, or the call failed). Leave the
        // column NULL rather than writing a placeholder — vectorSearch filters
        // on `embedding IS NOT NULL`, so this product cleanly degrades to text
        // search instead of being matched on meaningless coordinates.
        this.logger.warn(
          `[${tenantId}] No embedding available for "${product.name}" — ` +
            'leaving it NULL so retrieval falls back to text search',
        );
        return;
      }

      // Store embedding using raw SQL (Prisma doesn't support vector type
      // natively). Note the quoted "tenantId" — see vectorSearch for why
      // snake_case here silently broke every write.
      await this.prisma.$executeRaw`
        UPDATE products
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${productId}::uuid AND "tenantId" = ${tenantId}::uuid
      `;

      this.logger.log(
        `[${tenantId}] Embedding generated for product: ${product.name}`,
      );
    } catch (error) {
      this.logger.error(`Failed to store embedding for ${productId}: ${error}`);
    }
  }

  // ── Private methods ────────────────────────────────────────────

  private async vectorSearch(
    tenantId: string,
    query: string,
  ): Promise<RetrievedProduct[]> {
    const queryEmbedding = await this.embeddings.generateEmbedding(query);

    // No embedding for the query means no meaningful vector comparison is
    // possible. Return empty so retrieve() falls through to text search
    // rather than ranking the catalog against a meaningless vector.
    if (queryEmbedding === null) {
      return [];
    }

    const vector = JSON.stringify(queryEmbedding);

    // pgvector cosine similarity search.
    //
    // The similarity floor matters: without it this always returned the TOP_K
    // "least dissimilar" rows no matter how irrelevant, and those rows were
    // then handed to the extractor as authoritative catalog grounding —
    // encouraging exactly the hallucinated product matches RAG exists to stop.
    // Identifiers are quoted camelCase, NOT snake_case. The Prisma schema maps
    // only the TABLE name (`@@map("products")`) — the columns keep their model
    // field names, so Postgres created them as "tenantId", "isActive" and
    // "deletedAt". This query previously used snake_case, so it threw
    // `column "tenant_id" does not exist` on EVERY call. retrieve() catches
    // that and falls back to text search, so vector search silently never ran
    // and nothing surfaced except a warning log.
    const results = await this.prisma.$queryRaw<RetrievedProduct[]>`
      SELECT
        id,
        name,
        description,
        sku,
        price::float,
        "stockQuantity",
        attributes,
        1 - (embedding <=> ${vector}::vector) AS similarity
      FROM products
      WHERE
        "tenantId" = ${tenantId}::uuid
        AND "isActive" = true
        AND "deletedAt" IS NULL
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${vector}::vector) >= ${this.MIN_SIMILARITY}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${this.TOP_K}
    `;

    return results;
  }

  /**
   * Words carrying no product signal. Matching on these would return the
   * entire catalog for a message like "do you have this in stock".
   */
  private static readonly STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'buy',
    'can',
    'could',
    'delivery',
    'do',
    'does',
    'for',
    'get',
    'give',
    'have',
    'hello',
    'hey',
    'hi',
    'how',
    'i',
    'in',
    'is',
    'it',
    'like',
    'me',
    'my',
    'need',
    'of',
    'one',
    'order',
    'please',
    'send',
    'some',
    'thanks',
    'that',
    'the',
    'this',
    'to',
    'want',
    'was',
    'we',
    'what',
    'when',
    'where',
    'which',
    'will',
    'with',
    'would',
    'you',
    'your',
  ]);

  private async textSearch(
    tenantId: string,
    query: string,
  ): Promise<RetrievedProduct[]> {
    // The whole message used to be passed straight to `contains`, so
    // "I want to buy a mouse" was matched literally against product names —
    // which never hits "Wireless Mouse". The fallback therefore returned
    // nothing almost every time it was needed. Match on meaningful terms
    // instead, and OR them together.
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(
        (term) =>
          term.length > 2 && !ProductRetrieverService.STOP_WORDS.has(term),
      )
      .slice(0, 10); // bound the OR clause

    if (terms.length === 0) {
      return [];
    }

    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        OR: terms.flatMap((term) => [
          { name: { contains: term, mode: 'insensitive' as const } },
          { description: { contains: term, mode: 'insensitive' as const } },
          { sku: { contains: term, mode: 'insensitive' as const } },
        ]),
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

  /**
   * Overwrite the retrieved stock figures with variant stock (PR3).
   *
   * The catalogue context is what the AI quotes back to the customer. If it
   * showed product totals while order validation enforced variant stock, the
   * AI would promise an item and creation would then reject it — the worst of
   * both. One batch query, and every entry falls back to the product value.
   */
  private async applyVariantStock(
    tenantId: string,
    products: RetrievedProduct[],
  ): Promise<RetrievedProduct[]> {
    if (products.length === 0) return products;

    const stock = await this.variants.resolveStockMany(
      tenantId,
      products.map((p) => ({
        productId: p.id,
        fallbackStock: p.stockQuantity,
      })),
    );

    return products.map((p) => ({
      ...p,
      stockQuantity: stock.get(p.id) ?? p.stockQuantity,
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
