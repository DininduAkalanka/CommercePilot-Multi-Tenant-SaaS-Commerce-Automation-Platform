import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiAdapter } from './gemini.adapter';
import { ENTITY_EXTRACTION_USER_PROMPT } from '../prompts/system.prompts';

/**
 * These tests cover the MOCK path (GEMINI_API_KEY unset), which is what the
 * deployed service currently runs on.
 *
 * Regression context: the mock entity extractor used to open its own
 * `new PrismaClient()` and run an unfiltered `product.findMany()`. That leaked
 * other tenants' products into the extraction result and opened connections
 * outside the DI-managed pool. It is now grounded solely in the tenant-scoped
 * catalog block that ProductRetrieverService injects into the prompt.
 */
describe('GeminiAdapter (mock mode)', () => {
  let adapter: GeminiAdapter;

  const mockConfigService = {
    get: jest.fn((key: string, defaultVal?: string) => {
      // No GEMINI_API_KEY → mock mode.
      const config: Record<string, string> = {
        GEMINI_MODEL: 'gemini-1.5-flash',
      };
      return config[key] ?? defaultVal;
    }),
  };

  /** Mirrors ProductRetrieverService.formatCatalogContext output. */
  const catalogBlock = (entries: Array<{ id: string; name: string }>): string =>
    entries
      .map(
        (p, i) =>
          `${i + 1}. ID: ${p.id}
   Name: ${p.name}
   SKU: SKU-${i}
   Price: LKR 100
   Stock: 10 units
   Attributes: {}
   Description: n/a`,
      )
      .join('\n\n');

  const TENANT_A_PRODUCT = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Tenant A Wireless Mouse',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiAdapter,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    adapter = module.get<GeminiAdapter>(GeminiAdapter);
  });

  afterEach(() => jest.clearAllMocks());

  it('extracts only products present in the supplied catalog context', async () => {
    const userPrompt = ENTITY_EXTRACTION_USER_PROMPT(
      'I want to buy 2 mouse',
      catalogBlock([TENANT_A_PRODUCT]),
    );

    const response = await adapter.generateText(
      'You extract entities from orders.',
      userPrompt,
    );

    const parsed = adapter.parseJsonResponse<{
      items: Array<{ matched_product_id: string; quantity: number }>;
      missing_fields: string[];
    }>(response.text);

    expect(response.success).toBe(true);
    expect(parsed.items[0].matched_product_id).toBe(TENANT_A_PRODUCT.id);
    expect(parsed.items[0].quantity).toBe(2);
    expect(parsed.missing_fields).toEqual([]);
  });

  it('never returns a product id that was not in the prompt catalog', async () => {
    const userPrompt = ENTITY_EXTRACTION_USER_PROMPT(
      'I want to buy 1 mouse',
      catalogBlock([TENANT_A_PRODUCT]),
    );

    const response = await adapter.generateText(
      'You extract entities from orders.',
      userPrompt,
    );
    const parsed = adapter.parseJsonResponse<{
      items: Array<{ matched_product_id: string | null }>;
    }>(response.text);

    const allowedIds = [TENANT_A_PRODUCT.id];
    for (const item of parsed.items) {
      if (item.matched_product_id !== null) {
        expect(allowedIds).toContain(item.matched_product_id);
      }
    }
  });

  it('reports a missing product instead of inventing an id when the catalog is empty', async () => {
    const response = await adapter.generateText(
      'You extract entities from orders.',
      ENTITY_EXTRACTION_USER_PROMPT(
        'I want to buy 3 mouse',
        'No products found in catalog.',
      ),
    );

    const parsed = adapter.parseJsonResponse<{
      items: Array<{ matched_product_id: string | null }>;
      missing_fields: string[];
    }>(response.text);

    // Previously this returned a hardcoded UUID for a product that may not
    // exist for this tenant — or at all.
    expect(parsed.items[0].matched_product_id).toBeNull();
    expect(parsed.missing_fields).toContain('product');
  });

  // Regression: quantity used to be matched against the entire prompt, so the
  // catalog's own digits (list index, "LKR 100", "Stock: 10 units", SKU
  // suffixes) were read as the order quantity.
  it('flags a missing quantity rather than reading one out of the catalog', async () => {
    const response = await adapter.generateText(
      'You extract entities from orders.',
      ENTITY_EXTRACTION_USER_PROMPT(
        'do you sell mouse?',
        catalogBlock([TENANT_A_PRODUCT]),
      ),
    );

    const parsed = adapter.parseJsonResponse<{
      items: Array<{ quantity: number | null }>;
      missing_fields: string[];
    }>(response.text);

    expect(parsed.items[0].quantity).toBeNull();
    expect(parsed.missing_fields).toContain('quantity');
  });

  it('reads the quantity from the customer message, not the catalog', async () => {
    const response = await adapter.generateText(
      'You extract entities from orders.',
      ENTITY_EXTRACTION_USER_PROMPT(
        'send me 7 mouse please',
        catalogBlock([TENANT_A_PRODUCT]),
      ),
    );

    const parsed = adapter.parseJsonResponse<{
      items: Array<{ quantity: number | null }>;
    }>(response.text);

    expect(parsed.items[0].quantity).toBe(7);
  });
});
