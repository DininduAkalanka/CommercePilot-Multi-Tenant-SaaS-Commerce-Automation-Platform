import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QueryNormalizerService } from './query-normalizer.service';
import { AI_ADAPTER } from '../adapters/ai-adapter.interface';

/**
 * Written before the implementation.
 *
 * This exists to fix a total failure, not to improve a working path. Product
 * retrieval tokenises on `[^a-z0-9]`, which strips every Sinhala character, so
 * a Sinhala message produces zero search terms and matches nothing. With no
 * embedding provider configured, vector search returns null as well — so a
 * Sinhala customer currently gets no products at all.
 *
 * Measured before writing this: normalising to English took vector-search
 * margins from 0.010 to 0.421, and text-search terms from 0 to 2.
 *
 * The rules below all serve one principle — normalisation is an enhancement
 * that must never make retrieval worse than the raw message.
 */
describe('QueryNormalizerService', () => {
  let service: QueryNormalizerService;

  const mockAi = {
    generateText: jest.fn(),
    parseJsonResponse: jest.fn(),
  };

  const build = async (overrides: Record<string, string> = {}) => {
    const config: Record<string, string> = {
      QUERY_NORMALIZATION_ENABLED: 'true',
      ...overrides,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryNormalizerService,
        { provide: AI_ADAPTER, useValue: mockAi },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, fallback?: string) => config[key] ?? fallback,
            ),
          },
        },
      ],
    }).compile();

    return module.get<QueryNormalizerService>(QueryNormalizerService);
  };

  const ok = (text: string) => ({
    text,
    success: true,
    modelUsed: 'test',
    processingTimeMs: 1,
  });

  beforeEach(async () => {
    mockAi.generateText.mockResolvedValue(ok('blue shirt'));
    service = await build();
  });

  afterEach(() => jest.clearAllMocks());

  describe('when the message is not Latin script', () => {
    it('returns the English phrase the model produced', async () => {
      const result = await service.normalize('මට නිල් ෂර්ට් එකක් ඕන');

      expect(result).toBe('blue shirt');
    });

    it('sends the original message to the model', async () => {
      await service.normalize('නිල් ෂර්ට්');

      const [, userPrompt] = mockAi.generateText.mock.calls[0];
      expect(userPrompt).toContain('නිල් ෂර්ට්');
    });

    it('normalizes Tamil too, not just Sinhala', async () => {
      // Tamil is the other language this product has to serve.
      await service.normalize('எனக்கு நீল சட்டை வேண்டும்');

      expect(mockAi.generateText).toHaveBeenCalled();
    });
  });

  describe('when the message is already Latin script', () => {
    it('leaves plain English untouched and spends no quota', async () => {
      const result = await service.normalize('I want a blue shirt');

      expect(result).toBe('I want a blue shirt');
      expect(mockAi.generateText).not.toHaveBeenCalled();
    });

    it('is not fooled by tabs or newlines into calling the model', async () => {
      // WhatsApp messages contain line breaks routinely. Treating a control
      // character as "non-Latin script" would spend a call, and a retry, on
      // every multi-line English message.
      const result = await service.normalize('blue shirt\n\tsize L');

      expect(result).toBe('blue shirt\n\tsize L');
      expect(mockAi.generateText).not.toHaveBeenCalled();
    });

    it('is not fooled by an emoji', async () => {
      const result = await service.normalize('blue shirt 👕');

      expect(mockAi.generateText).not.toHaveBeenCalled();
      expect(result).toBe('blue shirt 👕');
    });

    it('leaves Singlish untouched', async () => {
      // Measured: Singlish already retrieves well (0.628, margin 0.322) and
      // tokenises fine. Spending a call and risking a bad rewrite would be
      // a downgrade, not an improvement.
      const result = await service.normalize('mata blue shirt ekak one');

      expect(result).toBe('mata blue shirt ekak one');
      expect(mockAi.generateText).not.toHaveBeenCalled();
    });
  });

  describe('never returns something worse than the input', () => {
    it('falls back to the original when the model call fails', async () => {
      mockAi.generateText.mockResolvedValue({
        text: '',
        success: false,
        modelUsed: 'test',
        processingTimeMs: 1,
        error: 'rate limited',
      });

      expect(await service.normalize('නිල් ෂර්ට්')).toBe('නිල් ෂර්ට්');
    });

    it('falls back to the original when the adapter throws', async () => {
      // Retrieval must not lose an order because normalisation broke.
      mockAi.generateText.mockRejectedValue(new Error('boom'));

      expect(await service.normalize('නිල් ෂර්ට්')).toBe('නිල් ෂර්ට්');
    });

    it('falls back when the model returns nothing usable', async () => {
      mockAi.generateText.mockResolvedValue(ok('   '));

      expect(await service.normalize('නිල් ෂර්ට්')).toBe('නිල් ෂර්ට්');
    });

    it('rejects a rambling answer instead of searching on it', async () => {
      // Instructed to reply with a short phrase, models sometimes explain
      // themselves. Feeding that into retrieval is worse than the original.
      mockAi.generateText.mockResolvedValue(
        ok(
          'Sure! The customer is asking about a blue shirt, and here is why ' +
            'I think that translation is the most appropriate one for this ' +
            'particular shopping request from the customer today.',
        ),
      );

      expect(await service.normalize('නිල් ෂර්ට්')).toBe('නිල් ෂර්ට්');
    });

    it('rejects a reply that is still not Latin script', async () => {
      // If the model echoes the input, normalisation achieved nothing and the
      // result would still tokenise to zero terms.
      mockAi.generateText.mockResolvedValue(ok('නිල් ෂර්ට්'));

      expect(await service.normalize('නිල් ෂර්ට්')).toBe('නිල් ෂර්ට්');
    });

    it('strips quotes the model wraps around its answer', async () => {
      mockAi.generateText.mockResolvedValue(ok('"blue shirt"'));

      expect(await service.normalize('නිල් ෂර්ට්')).toBe('blue shirt');
    });

    it('strips a trailing full stop', async () => {
      mockAi.generateText.mockResolvedValue(ok('blue shirt.'));

      expect(await service.normalize('නිල් ෂර්ට්')).toBe('blue shirt');
    });
  });

  describe('feature flag', () => {
    it('returns the message untouched when disabled', async () => {
      const disabled = await build({ QUERY_NORMALIZATION_ENABLED: 'false' });

      const result = await disabled.normalize('නිල් ෂර්ට්');

      expect(result).toBe('නිල් ෂර්ට්');
      expect(mockAi.generateText).not.toHaveBeenCalled();
    });

    it('is on by default — the failure it fixes is total', async () => {
      const defaulted = await build({
        QUERY_NORMALIZATION_ENABLED: undefined as unknown as string,
      });

      await defaulted.normalize('නිල් ෂර්ට්');

      expect(mockAi.generateText).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles an empty message without calling the model', async () => {
      expect(await service.normalize('')).toBe('');
      expect(mockAi.generateText).not.toHaveBeenCalled();
    });

    it('handles whitespace only', async () => {
      expect(await service.normalize('   ')).toBe('   ');
      expect(mockAi.generateText).not.toHaveBeenCalled();
    });

    it('uses a low temperature — this is translation, not creativity', async () => {
      await service.normalize('නිල් ෂර්ට්');

      const [, , config] = mockAi.generateText.mock.calls[0];
      expect(config.temperature).toBeLessThanOrEqual(0.1);
    });

    it('caps output tokens so a runaway reply cannot burn quota', async () => {
      await service.normalize('නිල් ෂර්ට්');

      const [, , config] = mockAi.generateText.mock.calls[0];
      expect(config.maxOutputTokens).toBeLessThanOrEqual(64);
    });
  });
});
