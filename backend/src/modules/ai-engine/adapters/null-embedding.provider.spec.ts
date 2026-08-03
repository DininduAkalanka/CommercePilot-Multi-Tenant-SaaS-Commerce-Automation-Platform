import { NullEmbeddingProvider } from './null-embedding.provider';

/**
 * Written before the implementation.
 *
 * This provider exists to make "we have no embeddings right now" an explicit,
 * safe state rather than an accident. It is what runs when no embedding key is
 * configured — which is the default, and was the live state the whole time
 * Groq was the only provider.
 */
describe('NullEmbeddingProvider', () => {
  let provider: NullEmbeddingProvider;

  beforeEach(() => {
    provider = new NullEmbeddingProvider();
  });

  it('returns null rather than a vector', async () => {
    expect(await provider.generateEmbedding('blue cotton shirt')).toBeNull();
  });

  it('never fabricates a vector, however often it is asked', async () => {
    // The regression this guards: generateEmbedding once returned
    // `Math.random() - 0.5` on failure, writing 768 dimensions of noise into
    // products.embedding permanently. pgvector ranked against it without
    // complaint, so the only symptom was silently wrong search results.
    const results = await Promise.all([
      provider.generateEmbedding('blue shirt'),
      provider.generateEmbedding('blue shirt'),
      provider.generateEmbedding('red dress'),
    ]);

    expect(results).toEqual([null, null, null]);
  });

  it('returns one null per input for batches, positionally aligned', async () => {
    // The backfill zips results against its input list, so a short array would
    // silently attach embeddings to the wrong products.
    const result = await provider.generateEmbeddings(['a', 'b', 'c']);

    expect(result).toEqual([null, null, null]);
  });

  it('handles an empty batch without special-casing', async () => {
    expect(await provider.generateEmbeddings([])).toEqual([]);
  });

  it('still reports the schema dimension', async () => {
    // Callers validate against this before writing to a vector(768) column;
    // reporting 0 here would make that check meaningless.
    expect(provider.dimensions).toBe(768);
  });
});
