import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GroqAdapter } from './groq.adapter';

/**
 * Written before the implementation.
 *
 * The behaviours pinned here are the ones that keep a provider swap safe: the
 * adapter never throws into the pipeline, never invents an embedding, and
 * never burns the free-tier quota retrying a request that cannot succeed.
 *
 * The live API was verified by hand before any of this was written — key
 * valid, 200ms, valid JSON on Sinhala and Singlish input. These tests cover
 * the failure paths that manual calls cannot reach.
 */
describe('GroqAdapter', () => {
  let adapter: GroqAdapter;
  let fetchMock: jest.Mock;

  const config: Record<string, string> = {
    GROQ_API_KEY: 'gsk_test_key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    GROQ_MAX_ATTEMPTS: '3',
    GROQ_TIMEOUT_MS: '20000',
    GROQ_RETRY_BASE_MS: '1', // keep the suite fast; production uses the default
  };

  const okBody = (text = '{"intent":"ORDER"}') => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: text } }],
        usage: { total_tokens: 42 },
      }),
  });

  const errBody = (status: number, message = 'boom') => ({
    ok: false,
    status,
    json: () => Promise.resolve({ error: { message } }),
    text: () => Promise.resolve(message),
  });

  const build = async (overrides: Record<string, string> = {}) => {
    const merged = { ...config, ...overrides };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroqAdapter,
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

    return module.get<GroqAdapter>(GroqAdapter);
  };

  beforeEach(async () => {
    fetchMock = jest.fn().mockResolvedValue(okBody());
    global.fetch = fetchMock;
    adapter = await build();
  });

  afterEach(() => jest.clearAllMocks());

  // ── generateText ────────────────────────────────────────────────
  describe('generateText', () => {
    it('sends the system and user prompts as separate roles', async () => {
      // Collapsing them into one user turn measurably degrades instruction
      // following on the smaller free-tier models.
      await adapter.generateText('You extract orders.', 'mata shirt ekak one');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.messages).toEqual([
        { role: 'system', content: 'You extract orders.' },
        { role: 'user', content: 'mata shirt ekak one' },
      ]);
    });

    it('authenticates with a bearer token and never puts the key in the URL', async () => {
      // Keys in URLs leak into proxy logs and error reports.
      await adapter.generateText('sys', 'user');

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer gsk_test_key');
      expect(String(url)).not.toContain('gsk_test_key');
    });

    it('returns the completion text with usage and timing', async () => {
      const res = await adapter.generateText('sys', 'user');

      expect(res.success).toBe(true);
      expect(res.text).toBe('{"intent":"ORDER"}');
      expect(res.tokenCount).toBe(42);
      expect(res.modelUsed).toBe('llama-3.3-70b-versatile');
      expect(res.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('passes temperature and token limit through', async () => {
      await adapter.generateText('sys', 'user', {
        temperature: 0.05,
        maxOutputTokens: 256,
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.temperature).toBe(0.05);
      expect(body.max_tokens).toBe(256);
    });

    it('requests guaranteed-JSON mode when asked', async () => {
      await adapter.generateText('sys', 'user', { jsonMode: true });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('omits response_format unless JSON was requested', async () => {
      await adapter.generateText('sys', 'user');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.response_format).toBeUndefined();
    });

    // ── failure handling ──────────────────────────────────────────
    it('never throws — a provider outage returns success:false', async () => {
      // A thrown error here would abort the whole pipeline stage and lose the
      // customer's order rather than degrading.
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await adapter.generateText('sys', 'user');

      expect(res.success).toBe(false);
      expect(res.error).toContain('ECONNREFUSED');
      expect(res.text).toBe('');
    });

    it('retries a 429 and succeeds on a later attempt', async () => {
      // The free tier rate-limits aggressively; a burst of WhatsApp messages
      // hits 429 routinely and must not lose orders.
      fetchMock
        .mockResolvedValueOnce(errBody(429, 'rate limited'))
        .mockResolvedValueOnce(okBody('recovered'));

      const res = await adapter.generateText('sys', 'user');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(res.success).toBe(true);
      expect(res.text).toBe('recovered');
    });

    it('retries a 500', async () => {
      fetchMock
        .mockResolvedValueOnce(errBody(500, 'server error'))
        .mockResolvedValueOnce(okBody('recovered'));

      const res = await adapter.generateText('sys', 'user');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(res.success).toBe(true);
    });

    it('does NOT retry a 401 — a bad key cannot be fixed by trying again', async () => {
      // Retrying auth failures wastes quota and delays a clear error.
      fetchMock.mockResolvedValue(errBody(401, 'invalid api key'));

      const res = await adapter.generateText('sys', 'user');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.success).toBe(false);
    });

    it('does NOT retry a 400', async () => {
      fetchMock.mockResolvedValue(errBody(400, 'bad request'));

      const res = await adapter.generateText('sys', 'user');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.success).toBe(false);
    });

    it('gives up after the configured attempts', async () => {
      fetchMock.mockResolvedValue(errBody(429, 'rate limited'));

      const res = await adapter.generateText('sys', 'user');

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(res.success).toBe(false);
    });

    it('surfaces a malformed success body instead of crashing on it', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ unexpected: true }),
      });

      const res = await adapter.generateText('sys', 'user');

      expect(res.success).toBe(false);
      expect(res.text).toBe('');
    });

    // ── mock mode ─────────────────────────────────────────────────
    it('runs offline when the key is still the placeholder', async () => {
      // Contributors clone and run without credentials; the pipeline must work.
      const a = await build({ GROQ_API_KEY: 'PASTE_YOUR_GROQ_KEY_HERE' });

      const res = await a.generateText('sys', 'I want 2 shirts');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.success).toBe(true);
      expect(res.modelUsed).toContain('mock');
    });

    it('runs offline when no key is configured at all', async () => {
      const a = await build({ GROQ_API_KEY: '' });

      const res = await a.generateText('sys', 'user');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.modelUsed).toContain('mock');
    });
  });

  // ── parseJsonResponse ───────────────────────────────────────────
  describe('parseJsonResponse', () => {
    it('parses plain JSON', () => {
      expect(adapter.parseJsonResponse('{"intent":"ORDER"}')).toEqual({
        intent: 'ORDER',
      });
    });

    it('strips markdown fences the model adds unbidden', () => {
      // Llama wraps JSON in ```json fences even when told not to, and even
      // with response_format set. Unstripped, every extraction fails to parse.
      expect(
        adapter.parseJsonResponse('```json\n{"intent":"ORDER"}\n```'),
      ).toEqual({ intent: 'ORDER' });
    });

    it('strips unlabelled fences too', () => {
      expect(adapter.parseJsonResponse('```\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('tolerates surrounding whitespace', () => {
      expect(adapter.parseJsonResponse('  \n {"a":1}  \n ')).toEqual({ a: 1 });
    });
  });

  // ── generateEmbedding ───────────────────────────────────────────
  describe('generateEmbedding', () => {
    it('always returns null — Groq serves no embedding models', async () => {
      // Verified against the live API: the models endpoint lists 15 models and
      // none support embeddings. Returning null makes retrieval degrade to text
      // search, which is correct and visible.
      const res = await adapter.generateEmbedding('blue cotton shirt');

      expect(res).toBeNull();
    });

    it('never invents a vector', async () => {
      // A random vector would poison pgvector similarity silently: every search
      // would return confident nonsense with no error anywhere.
      const a = await adapter.generateEmbedding('blue shirt');
      const b = await adapter.generateEmbedding('blue shirt');

      expect(a).toBeNull();
      expect(b).toBeNull();
    });

    it('makes no network call', async () => {
      await adapter.generateEmbedding('anything');

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
