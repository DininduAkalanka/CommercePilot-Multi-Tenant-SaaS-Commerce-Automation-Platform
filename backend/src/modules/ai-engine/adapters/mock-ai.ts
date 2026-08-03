import { Logger } from '@nestjs/common';

const logger = new Logger('MockAi');

/**
 * The canned AI used when no provider key is configured.
 *
 * Shared by every adapter because none of it is provider-specific — it reasons
 * about the assembled prompt and the catalogue inside it, which are the same
 * whichever model would have been called.
 *
 * It lived on GeminiAdapter until the Groq migration, when the new adapter got
 * a crude placeholder instead: one response shape, `items: []` always. That
 * broke the pipeline for anyone running without a key — the default for a
 * fresh clone — and took the order-flow and human-handoff E2E tests with it.
 * Nothing caught it because the E2E suite does not run in CI.
 *
 * Being stage-aware is the whole point. A mock that cannot distinguish intent
 * detection from entity extraction cannot produce a draft order, so every flow
 * that depends on one is untestable without spending real API quota.
 */

/** Products the retriever injected into the prompt, so the mock stays tenant-scoped. */
export function parseCatalogContext(
  userPrompt: string,
): Array<{ id: string; name: string }> {
  const entries: Array<{ id: string; name: string }> = [];
  const pattern =
    /ID:\s*([0-9a-fA-F-]{36})\s*[\r\n]+\s*Name:\s*(.+?)\s*[\r\n]/g;

  for (const match of userPrompt.matchAll(pattern)) {
    entries.push({ id: match[1], name: match[2].trim() });
  }

  return entries;
}

/**
 * Isolate the customer's own words from the assembled prompt.
 *
 * The prompt templates embed the tenant catalogue *above* the message, so
 * keyword and quantity detection that scans the whole prompt reads the
 * catalogue too — list numbers, "LKR 100", "Stock: 10 units" and SKUs all
 * match a bare `\d+`, which made the extracted quantity essentially random.
 * Falls back to the full prompt if neither marker is present.
 */
export function extractCustomerMessage(userPrompt: string): string {
  const match =
    /(?:CUSTOMER MESSAGE|LATEST MESSAGE):\s*"?([\s\S]*?)"?\s*(?:\n\n|$)/.exec(
      userPrompt,
    );

  return match ? match[1].trim() : userPrompt;
}

/** Canned response for whichever pipeline stage the prompt belongs to. */
export function buildMockResponse(
  systemPrompt: string,
  userPrompt: string,
): string {
  const sys = systemPrompt.toLowerCase();
  const usr = userPrompt.toLowerCase();

  // Everything below reasons about what the *customer* said, so it must read
  // the message alone — not the catalogue the prompt builder prepended.
  const customerMessage = extractCustomerMessage(userPrompt).toLowerCase();

  // ── 1. Intent detection ───────────────────────────────────────
  if (sys.includes('intent') || usr.includes('intent')) {
    const isOrder =
      customerMessage.includes('buy') ||
      customerMessage.includes('mouse') ||
      customerMessage.includes('keyboard') ||
      customerMessage.includes('shoes') ||
      customerMessage.includes('shirt') ||
      customerMessage.includes('order') ||
      customerMessage.includes('yes') ||
      customerMessage.includes('ok');

    return JSON.stringify({
      intent: isOrder ? 'ORDER' : 'OTHER',
      confidence: isOrder ? 0.95 : 0.0,
    });
  }

  // ── 2. Entity extraction ──────────────────────────────────────
  if (
    sys.includes('extract') ||
    usr.includes('extract') ||
    sys.includes('entity')
  ) {
    // Grounded ONLY in the tenant-scoped catalogue the retriever injected into
    // this prompt. An earlier version opened its own PrismaClient and ran an
    // unfiltered findMany, which leaked other tenants' products into the
    // extraction and leaked connections outside the DI-managed pool.
    const catalog = parseCatalogContext(userPrompt);

    const keyword = ['mouse', 'keyboard', 'shoes', 'shirt'].find((k) =>
      customerMessage.includes(k),
    );

    const matchedProduct =
      (keyword
        ? catalog.find((p) => p.name.toLowerCase().includes(keyword))
        : undefined) ??
      catalog[0] ??
      null;

    if (!matchedProduct) {
      logger.warn(
        '[MOCK AI] No catalog context in prompt — returning an unmatched extraction',
      );
    }

    // Quantity comes from the customer's message only. Scanning the whole
    // prompt matched catalogue digits instead — the list index, "LKR 100",
    // "Stock: 10 units", SKU suffixes — so the quantity was effectively
    // whatever number appeared first in the catalogue.
    let quantity: number | null = null;
    const qtyMatch = /\b(\d+)\b/.exec(customerMessage);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
    } else if (
      customerMessage.includes('a ') ||
      customerMessage.includes('one ')
    ) {
      quantity = 1;
    }

    // Report what is genuinely absent. A missing product match must surface as
    // a missing field so the pipeline routes to `gather_more_info` rather than
    // drafting an order against an invented product id.
    const missingFields: string[] = [];
    if (!matchedProduct) missingFields.push('product');
    if (quantity === null) missingFields.push('quantity');

    return JSON.stringify({
      items: [
        {
          product_query: keyword ?? matchedProduct?.name ?? 'unknown',
          matched_product_name: matchedProduct?.name ?? null,
          matched_product_id: matchedProduct?.id ?? null,
          match_confidence: matchedProduct ? 0.95 : 0.0,
          quantity,
          selected_attributes: {},
        },
      ],
      delivery_info: {
        address: usr.includes('deliver to')
          ? usr.split('deliver to')[1].trim()
          : null,
      },
      missing_fields: missingFields,
    });
  }

  // ── 3. Follow-up question ─────────────────────────────────────
  if (
    sys.includes('follow-up') ||
    usr.includes('follow-up') ||
    sys.includes('question')
  ) {
    return 'To complete your order, could you please confirm: quantity?';
  }

  return 'I can help you with your order. What would you like to buy?';
}
