import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CorrectDraftDto } from './correct-draft.dto';

/**
 * Regression: the dashboard reads a draft from the API and posts the same
 * values back. `unitPrice` originates from a Prisma `Decimal` column, which
 * serialises to a JSON STRING ("25.00"), so the round-trip sends a string.
 *
 * The first version of this DTO used a bare `@IsNumber()`, which rejected it:
 *
 *   400 correctedData.items.0.unitPrice must be a number
 *
 * The global `enableImplicitConversion` does not help, because `number | null`
 * emits design:type Object and class-transformer has no target type to convert
 * to. The E2E order flow caught this; unit tests on the service could not,
 * because they bypass the ValidationPipe entirely.
 */
describe('CorrectDraftDto', () => {
  const validate = (payload: unknown) => {
    const dto = plainToInstance(CorrectDraftDto, payload, {
      enableImplicitConversion: true,
    });
    return validateSync(dto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  };

  /** Exactly what frontend/src/app/dashboard/orders/page.tsx sends. */
  const dashboardPayload = (overrides: Record<string, unknown> = {}) => ({
    correctedData: {
      items: [
        {
          product_query: 'E2E Test Widget',
          matched_product_id: 'b57023ff-cad9-4017-b08a-8935e1da61c0',
          matched_product_name: 'E2E Test Widget',
          match_confidence: 1.0,
          quantity: 1,
          unitPrice: '25.00', // ← string, straight from a Decimal column
          selected_attributes: {},
          ...overrides,
        },
      ],
      delivery_info: { address: 'Colombo' },
      missing_fields: [],
    },
  });

  it('accepts a unitPrice that arrives as a string', () => {
    expect(validate(dashboardPayload())).toHaveLength(0);
  });

  it('coerces the string price to a number', () => {
    const dto = plainToInstance(CorrectDraftDto, dashboardPayload(), {
      enableImplicitConversion: true,
    });

    expect(dto.correctedData.items[0].unitPrice).toBe(25);
    expect(typeof dto.correctedData.items[0].unitPrice).toBe('number');
  });

  it('accepts a numeric unitPrice too', () => {
    expect(validate(dashboardPayload({ unitPrice: 25 }))).toHaveLength(0);
  });

  it('keeps a null unitPrice null rather than coercing it to 0', () => {
    // `@Type(() => Number)` would turn null into 0 and silently zero a price.
    const dto = plainToInstance(
      CorrectDraftDto,
      dashboardPayload({ unitPrice: null }),
      { enableImplicitConversion: true },
    );

    expect(dto.correctedData.items[0].unitPrice).toBeNull();
    expect(validate(dashboardPayload({ unitPrice: null }))).toHaveLength(0);
  });

  it('accepts a string quantity', () => {
    expect(validate(dashboardPayload({ quantity: '2' }))).toHaveLength(0);
  });

  it('still rejects a genuinely invalid price', () => {
    expect(
      validate(dashboardPayload({ unitPrice: 'not-a-price' })),
    ).not.toHaveLength(0);
  });

  it('still rejects a non-UUID product id', () => {
    expect(
      validate(dashboardPayload({ matched_product_id: 'nope' })),
    ).not.toHaveLength(0);
  });

  it('still rejects quantity below 1', () => {
    expect(validate(dashboardPayload({ quantity: 0 }))).not.toHaveLength(0);
  });
});
