/**
 * Embeddings are a separate concern from text generation.
 *
 * They used to share the `AiAdapter` interface, which stopped making sense the
 * moment the two came from different vendors: Groq generates text well and has
 * no embedding models at all, so it was forced to carry a method that could
 * only ever return null. Splitting the interfaces lets each provider be chosen
 * on its own merits.
 *
 * The 768-dimension expectation is not configurable taste — `products.embedding`
 * is `vector(768)` and its HNSW index is built for that width. A provider
 * returning a different length must be truncated or rejected, never stored.
 */

/** DI token, so the embedding provider can be swapped independently of the LLM. */
export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';

export interface EmbeddingProvider {
  /**
   * `null` means "no embedding available" — never a fabricated vector.
   *
   * This is the single most important rule in this file. A random or zero
   * vector is worse than nothing: pgvector ranks against it happily, so every
   * product search returns confident nonsense with nothing in the logs to
   * explain it. This codebase has already shipped that bug once — a transient
   * API failure wrote 768 dimensions of `Math.random() - 0.5` into a product
   * row permanently, and nothing ever recomputed it.
   *
   * Callers treat null as "fall back to text search", which is correct and
   * visible.
   */
  generateEmbedding(text: string): Promise<number[] | null>;

  /**
   * Embed many texts in one call.
   *
   * Exists for the catalog backfill. Embedding 500 products one request at a
   * time is 500 round trips against a rate-limited free tier; providers accept
   * batches and it is the difference between minutes and hours.
   *
   * Returns one entry per input, positionally aligned, with `null` for any that
   * failed. Callers must not assume the array is dense.
   */
  generateEmbeddings(texts: string[]): Promise<(number[] | null)[]>;

  /** Dimension count this provider is configured to emit. */
  readonly dimensions: number;
}
