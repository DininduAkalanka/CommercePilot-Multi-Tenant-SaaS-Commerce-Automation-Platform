import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SoftAlternativesService } from './soft-alternatives.service';

/**
 * Phase 2 item 2.5 — written before the implementation.
 *
 * Today an unmatched request is logged to UnfulfilledDemand and the customer
 * is told nothing useful. The shop learns about the miss; the customer just
 * leaves. This closes that gap using the products retrieval already fetched —
 * no extra query, no extra model call.
 *
 * Two rules govern everything here, and both are about not making the miss
 * worse:
 *   1. Never offer something that cannot ship. Suggesting a sold-out item is
 *      the same false promise the whole product exists to avoid.
 *   2. Acknowledge the miss first. Jumping straight to alternatives reads as
 *      if the question was ignored.
 */
describe('SoftAlternativesService', () => {
  let service: SoftAlternativesService;

  const product = (
    name: string,
    stockQuantity = 5,
    price = 1500,
  ): {
    id: string;
    name: string;
    price: number;
    stockQuantity: number;
  } => ({
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    price,
    stockQuantity,
  });

  const build = async (overrides: Record<string, string> = {}) => {
    const config: Record<string, string> = {
      SOFT_ALTERNATIVES_ENABLED: 'true',
      ...overrides,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoftAlternativesService,
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

    return module.get<SoftAlternativesService>(SoftAlternativesService);
  };

  beforeEach(async () => {
    service = await build();
  });

  describe('build', () => {
    it('acknowledges the miss before offering anything', async () => {
      const message = service.build('red shoes', [product('Blue Shirt')]);

      expect(message).not.toBeNull();
      // The customer's own words come back to them, so it is clear they were
      // understood and not simply ignored.
      expect(message).toContain('red shoes');
    });

    it('offers the alternatives by name and price', async () => {
      const message = service.build('red shoes', [
        product('Blue Shirt', 5, 1500),
      ]);

      expect(message).toContain('Blue Shirt');
      expect(message).toContain('1500');
    });

    it('offers at most three — this is not a catalogue dump', async () => {
      const message = service.build('red shoes', [
        product('One'),
        product('Two'),
        product('Three'),
        product('Four'),
        product('Five'),
      ]);

      expect(message).toContain('One');
      expect(message).toContain('Three');
      expect(message).not.toContain('Four');
      expect(message).not.toContain('Five');
    });

    it('never offers something that is out of stock', async () => {
      // Suggesting a sold-out item is the same false promise the whole
      // product exists to prevent — worse than offering nothing.
      const message = service.build('red shoes', [
        product('Sold Out Shirt', 0),
        product('Available Shirt', 4),
      ]);

      expect(message).not.toContain('Sold Out Shirt');
      expect(message).toContain('Available Shirt');
    });

    it('returns null when every candidate is out of stock', async () => {
      // Nothing honest to offer. The caller falls through to its existing
      // path — asking a follow-up, or handing off to a person.
      const message = service.build('red shoes', [
        product('Sold Out', 0),
        product('Also Sold Out', 0),
      ]);

      expect(message).toBeNull();
    });

    it('returns null when retrieval found nothing at all', async () => {
      expect(service.build('red shoes', [])).toBeNull();
    });

    it('returns null without a query to acknowledge', async () => {
      expect(service.build('', [product('Blue Shirt')])).toBeNull();
      expect(service.build('   ', [product('Blue Shirt')])).toBeNull();
    });

    it('invites a reply rather than ending the conversation', async () => {
      // A dead end is what this exists to prevent, so the message has to leave
      // an obvious way to continue.
      const message = service.build('red shoes', [product('Blue Shirt')]);

      expect(message).toMatch(/\?/);
    });

    it('never claims to be a person', async () => {
      // BUSINESS_RULES: the handoff to a human is only meaningful if the bot
      // never pretended to be one.
      const message = service.build('red shoes', [product('Blue Shirt')]);

      expect(message?.toLowerCase()).not.toMatch(
        /\bi am a (human|person)\b|\bspeaking to a person\b/,
      );
    });

    it('returns null when disabled, so the old behaviour is restored', async () => {
      const disabled = await build({ SOFT_ALTERNATIVES_ENABLED: 'false' });

      expect(disabled.build('red shoes', [product('Blue Shirt')])).toBeNull();
    });

    it('is on by default — a dead end is the worse outcome', async () => {
      const defaulted = await build({
        SOFT_ALTERNATIVES_ENABLED: undefined as unknown as string,
      });

      expect(
        defaulted.build('red shoes', [product('Blue Shirt')]),
      ).not.toBeNull();
    });
  });
});
