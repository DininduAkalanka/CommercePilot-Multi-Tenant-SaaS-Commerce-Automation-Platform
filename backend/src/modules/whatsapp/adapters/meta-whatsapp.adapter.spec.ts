import { ConfigService } from '@nestjs/config';
import { MetaWhatsAppAdapter } from './meta-whatsapp.adapter';

function buildAdapter(
  overrides: Record<string, string> = {},
): MetaWhatsAppAdapter {
  const values: Record<string, string> = {
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_ACCESS_TOKEN: 'test-token',
    WHATSAPP_API_VERSION: 'v18.0',
    ...overrides,
  };
  const config = {
    get: (name: string, fallback?: string) => values[name] ?? fallback,
  } as unknown as ConfigService;
  return new MetaWhatsAppAdapter(config);
}

describe('MetaWhatsAppAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends a text message and returns the Graph message id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.ABC' }] }),
    });
    global.fetch = fetchMock;

    const adapter = buildAdapter();
    const result = await adapter.sendTextMessage('+94771234567', 'Hello');

    expect(result).toEqual({ success: true, messageId: 'wamid.ABC' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v18.0/123456/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '+94771234567',
      type: 'text',
      text: { body: 'Hello' },
    });
  });

  it('returns success:false with the API error on a non-2xx response (no throw)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid OAuth token' } }),
    });

    const adapter = buildAdapter();
    const result = await adapter.sendTextMessage('+94771234567', 'Hi');

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('Invalid OAuth token');
  });

  it('fails cleanly when the API is not configured', async () => {
    const adapter = buildAdapter({ WHATSAPP_ACCESS_TOKEN: '' });
    const result = await adapter.sendTextMessage('+94771234567', 'Hi');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('markAsRead never throws even if the request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const adapter = buildAdapter();
    await expect(adapter.markAsRead('wamid.XYZ')).resolves.toBeUndefined();
  });
});
