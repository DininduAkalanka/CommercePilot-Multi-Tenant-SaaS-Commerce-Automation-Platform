import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingProvider } from './embedding-provider.interface';

/**
 * The embedding provider used when none is configured.
 *
 * Makes "we have no embeddings right now" an explicit, safe state instead of
 * an accident. This is the default, and it was the live state for the whole
 * period Groq was the only provider — vector search returned nothing and
 * retrieval fell back to text matching, which is correct behaviour rather than
 * a failure.
 *
 * Returning null is the entire point. A random or zero vector would let
 * pgvector rank against nonsense with nothing in the logs to explain it, which
 * is precisely the bug this codebase already shipped once.
 */
@Injectable()
export class NullEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(NullEmbeddingProvider.name);

  /**
   * Still reports the schema width. Callers validate a vector's length against
   * this before writing to a `vector(768)` column, so reporting 0 would make
   * that check silently useless.
   */
  readonly dimensions = 768;

  generateEmbedding(_text: string): Promise<number[] | null> {
    this.logger.debug(
      'No embedding provider configured — product search will use text matching',
    );

    return Promise.resolve(null);
  }

  generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    // One null per input: the backfill zips results against its input list, so
    // a short array would attach embeddings to the wrong products.
    return Promise.resolve(texts.map(() => null));
  }
}
