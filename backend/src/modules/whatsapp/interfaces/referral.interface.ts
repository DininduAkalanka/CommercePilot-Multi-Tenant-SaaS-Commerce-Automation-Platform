/**
 * The Meta "referral" object.
 *
 * Delivered on the first message of a conversation that started from a
 * Click-to-WhatsApp ad or a post with a WhatsApp CTA. Every field is optional
 * because Meta's payload varies by source type and ad format — treat anything
 * here as untrusted input from an external system.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
export interface WhatsAppReferral {
  source_url?: string;
  /** 'ad' | 'post' — kept loose, Meta has added values before. */
  source_type?: string;
  /** The ad or post id. The most reliable product identifier available. */
  source_id?: string;
  /** Ad/post headline, e.g. "Blue Cotton Shirt - New Arrival". */
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  /** Click-to-WhatsApp click id, for attribution. */
  ctwa_clid?: string;
}

/** Longest referral text fed into retrieval; ad copy can be very long. */
const MAX_HINT_LENGTH = 200;

/**
 * Narrow an untrusted webhook value into a referral, or null.
 *
 * Meta controls this payload, so nothing about its shape is guaranteed. Any
 * non-object, or an object with no usable field, yields null so callers have
 * exactly one thing to check.
 */
export function parseReferral(value: unknown): WhatsAppReferral | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof raw[key] === 'string' && raw[key] !== '' ? raw[key] : undefined;

  const referral: WhatsAppReferral = {
    source_url: str('source_url'),
    source_type: str('source_type'),
    source_id: str('source_id'),
    headline: str('headline'),
    body: str('body'),
    media_type: str('media_type'),
    image_url: str('image_url'),
    video_url: str('video_url'),
    thumbnail_url: str('thumbnail_url'),
    ctwa_clid: str('ctwa_clid'),
  };

  const hasSomething = Object.values(referral).some((v) => v !== undefined);
  return hasSomething ? referral : null;
}

/**
 * Build the retrieval hint from a referral.
 *
 * The headline and body are the merchant's own words for the product they
 * advertised — "Blue Cotton Shirt - New Arrival" is a far better search query
 * than "mata meka one" ("I want this"). Feeding it into retrieval alongside the
 * customer's message is what lets the system resolve a message that names no
 * product at all.
 *
 * Returns null when there is nothing useful, so callers can skip cleanly.
 */
export function buildReferralHint(
  referral: WhatsAppReferral | null,
): string | null {
  if (!referral) return null;

  const hint = [referral.headline, referral.body]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .trim();

  if (!hint) return null;

  return hint.length > MAX_HINT_LENGTH ? hint.slice(0, MAX_HINT_LENGTH) : hint;
}
