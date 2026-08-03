import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JinaEmbeddingProvider } from './jina-embedding.provider';

/**
 * Written before the implementation.
 *
 * Verified against the live API first: 768 dimensions on request, and
 * Singlish->English retrieval at 0.628 with a 0.322 margin. Sinhala script
 * scores as noise (margins of 0.005-0.035) and is fixed upstream by
 * normalising the query, not here.
 *
 * The rules pinned below are the ones that keep a bad response out of the
 * database. A wrong-width or malformed vector must never reach
 * `products.embedding`.
 */
describe('JinaEmbeddingProvider', () => {
  let provider: JinaEmbeddingProvider;
  let fetchMock: jest.Mock;

  const config: Record<string, string> = {
    JINA_API_KEY: 'jina_test_key',
    JINA_MODEL: 'jina-embeddings-v3',
    JINA_DIMENSIONS: '768',
    JINA_MAX_ATTEMPTS: '3',
    JINA_RETRY_BASE_MS: '1',
  };

  const vector = (n = 768, fill = 0.1) => new Array(n).fill(fill);

  const okBody = (vectors: number[][]) => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: vectors.map((embedding, index) => ({ embedding, index })),
        usage: { total_tokens: 10 },
      }),
  });

  const errBody = (status: number, message = 'boom') => ({
    ok: false,
    status,
    json: () => Promise.resolve({ detail: message }),
  });

  const build = async (overrides: Record<string, string> = {}) => {
    const merged = { ...config, ...overrides };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JinaEmbeddingProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, fallback?: string) => merged[key] ?? fallback,
            ),
          },
        },
      ],
    }).compile();

    return module.get<JinaEmbeddingProvider>(JinaEmbeddingProvider);
  };

  beforeEach(async () => {
    fetchMock = jest.fn().mockResolvedValue(okBody([vector()]));
    global.fetch = fetchMock;
    provider = await build();
  });

  afterEach(() => jest.clearAllMocks());

  // ── request shape ───────────────────────────────────────────────
  describe('request', () => {
    it('asks for 768 dimensions explicitly', async () => {
      // products.embedding is vector(768) and its HNSW index is built for that
      // width. Jina defaults to 1024, which would fail every insert.
      await provider.generateEmbedding('blue shirt');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.dimensions).toBe(768);
    });

    it('uses text-matching, not the asymmetric retrieval tasks', async () => {
      // Measured: retrieval.query/retrieval.passage scored Sinhala queries
      // NEGATIVE against English products. text-matching was strictly better
      // on this catalogue.
      await provider.generateEmbedding('blue shirt');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.task).toBe('text-matching');
    });

    it('authenticates with a bearer token, never in the URL', async () => {
      await provider.generateEmbedding('x');

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer jina_test_key');
      expect(String(url)).not.toContain('jina_test_key');
    });
  });

  // ── generateEmbedding ───────────────────────────────────────────
  describe('generateEmbedding', () => {
    it('returns the vector', async () => {
      const res = await provider.generateEmbedding('blue shirt');

      expect(res).toHaveLength(768);
    });

    it('returns null rather than throwing when the API fails', async () => {
      // An indexing failure must not abort a customer's order pipeline.
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      expect(await provider.generateEmbedding('x')).toBeNull();
    });

    it('rejects a wrong-width vector instead of storing it', async () => {
      // The single most dangerous response: a 1024-wide vector inserted into a
      // vector(768) column either errors at write time or, worse, silently
      // corrupts similarity if a future migration widens the column.
      fetchMock.mockResolvedValue(okBody([vector(1024)]));

      expect(await provider.generateEmbedding('x')).toBeNull();
    });

    it('rejects a non-numeric vector', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ data: [{ embedding: ['a', 'b'], index: 0 }] }),
      });

      expect(await provider.generateEmbedding('x')).toBeNull();
    });

    it('returns null on an empty data array', async () => {
      fetchMock.mockResolvedValue(okBody([]));

      expect(await provider.generateEmbedding('x')).toBeNull();
    });

    it('returns null for blank input without calling the API', async () => {
      // Embedding whitespace wastes free-tier quota and yields a meaningless
      // vector that would still rank against the catalogue.
      expect(await provider.generateEmbedding('   ')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('runs offline when the key is still the placeholder', async () => {
      const p = await build({ JINA_API_KEY: 'PASTE_YOUR_JINA_KEY_HERE' });

      expect(await p.generateEmbedding('blue shirt')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── batching ────────────────────────────────────────────────────
  describe('generateEmbeddings', () => {
    it('sends one request for the whole batch', async () => {
      // The backfill embeds the entire catalogue. One request per product
      // against a rate-limited free tier is the difference between minutes
      // and hours.
      fetchMock.mockResolvedValue(okBody([vector(), vector(), vector()]));

      await provider.generateEmbeddings(['a', 'b', 'c']);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.input).toEqual(['a', 'b', 'c']);
    });

    it('returns results positionally aligned with the input', async () => {
      // The backfill zips these against product ids. Misalignment would attach
      // one product's embedding to another — silently wrong search forever.
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              { embedding: vector(768, 0.3), index: 2 },
              { embedding: vector(768, 0.1), index: 0 },
              { embedding: vector(768, 0.2), index: 1 },
            ],
          }),
      });

      const res = await provider.generateEmbeddings(['a', 'b', 'c']);

      expect(res[0]?.[0]).toBeCloseTo(0.1);
      expect(res[1]?.[0]).toBeCloseTo(0.2);
      expect(res[2]?.[0]).toBeCloseTo(0.3);
    });

    it('returns a null per input when the whole batch fails', async () => {
      fetchMock.mockRejectedValue(new Error('down'));

      expect(await provider.generateEmbeddings(['a', 'b'])).toEqual([
        null,
        null,
      ]);
    });

    it('nulls only the entries the API omitted', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ data: [{ embedding: vector(), index: 0 }] }),
      });

      const res = await provider.generateEmbeddings(['a', 'b']);

      expect(res[0]).toHaveLength(768);
      expect(res[1]).toBeNull();
    });

    it('handles an empty batch without calling the API', async () => {
      expect(await provider.generateEmbeddings([])).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── retry policy ────────────────────────────────────────────────
  describe('retries', () => {
    it('retries a 429 — the free tier rate-limits the backfill', async () => {
      fetchMock
        .mockResolvedValueOnce(errBody(429))
        .mockResolvedValueOnce(okBody([vector()]));

      expect(await provider.generateEmbedding('x')).toHaveLength(768);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry a 401', async () => {
      fetchMock.mockResolvedValue(errBody(401, 'bad key'));

      expect(await provider.generateEmbedding('x')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('reports its configured dimensions', async () => {
    expect(provider.dimensions).toBe(768);
  });
});
