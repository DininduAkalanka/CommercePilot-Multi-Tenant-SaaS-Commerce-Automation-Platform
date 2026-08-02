import { parseReferral, buildReferralHint } from './referral.interface';

/**
 * The referral object comes straight from Meta's webhook, so it is untrusted
 * input from an external system whose shape has changed before. Everything
 * here is about degrading to null rather than throwing inside the message
 * path — a malformed referral must never cost a customer their order.
 */
describe('parseReferral', () => {
  it('parses a realistic Click-to-WhatsApp payload', () => {
    const referral = parseReferral({
      source_url: 'https://fb.me/abc',
      source_type: 'ad',
      source_id: '1234567890',
      headline: 'Blue Cotton Shirt - New Arrival',
      body: 'Now available in all sizes',
      media_type: 'image',
      image_url: 'https://cdn/img.jpg',
      ctwa_clid: 'clid-xyz',
    });

    expect(referral).not.toBeNull();
    expect(referral?.source_id).toBe('1234567890');
    expect(referral?.headline).toBe('Blue Cotton Shirt - New Arrival');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not-an-object'],
    ['a number', 42],
    ['an array', ['ad']],
    ['an empty object', {}],
  ])('returns null for %s', (_label, value) => {
    expect(parseReferral(value)).toBeNull();
  });

  it('ignores non-string and empty fields rather than trusting them', () => {
    const referral = parseReferral({
      source_id: 12345, // Meta sends strings; a number is not one
      headline: '',
      body: 'Real copy',
    });

    expect(referral?.source_id).toBeUndefined();
    expect(referral?.headline).toBeUndefined();
    expect(referral?.body).toBe('Real copy');
  });

  it('keeps a referral that has only a source_id', () => {
    // Enough to identify the ad even with no copy attached.
    expect(parseReferral({ source_id: 'abc' })?.source_id).toBe('abc');
  });
});

describe('buildReferralHint', () => {
  it('joins headline and body into a retrieval query', () => {
    const hint = buildReferralHint({
      headline: 'Blue Cotton Shirt',
      body: 'New Arrival',
    });

    expect(hint).toBe('Blue Cotton Shirt New Arrival');
  });

  it('works from a headline alone', () => {
    expect(buildReferralHint({ headline: 'Cotton Saree' })).toBe(
      'Cotton Saree',
    );
  });

  it('returns null when there is no usable copy', () => {
    // A referral with only tracking data gives retrieval nothing to match on.
    expect(buildReferralHint({ source_id: 'abc', ctwa_clid: 'x' })).toBeNull();
    expect(buildReferralHint({ headline: '   ' })).toBeNull();
    expect(buildReferralHint(null)).toBeNull();
  });

  it('truncates very long ad copy', () => {
    // Ad body text can run to paragraphs; unbounded text would bloat the
    // embedding query and the prompt built from it.
    const hint = buildReferralHint({ headline: 'x'.repeat(500) });

    expect(hint).toHaveLength(200);
  });
});
