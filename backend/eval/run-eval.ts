/* eslint-disable no-console */
/**
 * Extraction evaluation harness.
 *
 *   npm run eval                 # default dataset
 *   npm run eval -- --limit 5    # first 5 rows only
 *   npm run eval -- --verbose    # show every row, not just failures
 *   npm run eval -- --dataset eval/my-real-messages.csv
 *
 * Runs each message in the dataset through the REAL intent + extraction
 * prompts and scores the result against hand-labelled expectations, then
 * reports accuracy broken down by language.
 *
 * WHY IT ONLY TALKS TO THE ADAPTER, NOT THE FULL PIPELINE
 * We are measuring how well the model reads a customer message — not database
 * plumbing. Driving the CONFIGURED adapter directly with the production
 * prompts keeps
 * the harness runnable with no Postgres, no Redis and no tenant setup, so it
 * can run anywhere including CI.
 *
 * WITHOUT A GEMINI_API_KEY THE NUMBERS ARE MEANINGLESS. The adapter falls back
 * to a canned mock extractor, so an eval run measures the mock rather than the
 * model. The harness detects this and says so loudly rather than printing an
 * impressive score that means nothing.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
// Load .env before anything reads process.env. A standalone ConfigService
// (no ConfigModule.forRoot) does NOT read .env, so without this the harness
// silently measured the mock no matter which key was configured.
import 'dotenv/config';

import { GeminiAdapter } from '../src/modules/ai-engine/adapters/gemini.adapter';
import { GroqAdapter } from '../src/modules/ai-engine/adapters/groq.adapter';
import type { AiAdapter } from '../src/modules/ai-engine/adapters/ai-adapter.interface';
import {
  INTENT_DETECTION_SYSTEM_PROMPT,
  INTENT_DETECTION_USER_PROMPT,
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  ENTITY_EXTRACTION_USER_PROMPT,
} from '../src/modules/ai-engine/prompts/system.prompts';

// ── Types ────────────────────────────────────────────────────────

interface EvalRow {
  id: string;
  message: string;
  language: string;
  expected_intent: string;
  expected_product: string;
  expected_quantity: string;
  expected_size: string;
  expected_color: string;
  expected_address: string;
  expected_missing: string;
  notes: string;
}

interface FieldResult {
  field: string;
  expected: string;
  actual: string;
  ok: boolean;
  /** Not every row asserts every field; unasserted fields are not scored. */
  scored: boolean;
}

interface RowResult {
  row: EvalRow;
  fields: FieldResult[];
  passed: boolean;
  error?: string;
}

// ── Minimal CSV reader ───────────────────────────────────────────
// Hand-rolled rather than adding a dependency for a dev-only tool. Handles
// quoted fields containing commas and escaped double quotes, which the
// dataset genuinely needs ("Colombo 07 ta deliver karanna" rows have commas).

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (record.some((c) => c.trim() !== '')) rows.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') pushRecord();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length > 0) pushRecord();

  const [header, ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()])),
  );
}

// ── Catalog context ──────────────────────────────────────────────

interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  stockQuantity: number;
  attributes: Record<string, unknown>;
}

/**
 * Mirrors ProductRetrieverService.formatCatalogContext exactly.
 * If that format drifts, this must follow — the model's ability to match a
 * product depends on the shape it is shown.
 */
function formatCatalogContext(products: CatalogProduct[]): string {
  if (products.length === 0) return 'No products found in catalog.';

  return products
    .map(
      (p, i) =>
        `${i + 1}. ID: ${p.id}
   Name: ${p.name}
   SKU: ${p.sku ?? 'N/A'}
   Price: LKR ${p.price}
   Stock: ${p.stockQuantity} units
   Attributes: ${JSON.stringify(p.attributes ?? {})}
   Description: N/A`,
    )
    .join('\n\n');
}

// ── Comparison ───────────────────────────────────────────────────

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/**
 * Product match is deliberately fuzzy. The label says "White School Shirt";
 * the model may answer "White School Shirt (S)" or "school shirt". Requiring
 * an exact string would report failures that are actually correct matches, so
 * containment in either direction counts.
 */
function productMatches(expected: string, actual: string): boolean {
  const e = norm(expected);
  const a = norm(actual);
  if (!e) return !a;
  if (!a) return false;
  return a.includes(e) || e.includes(a);
}

function compare(row: EvalRow, extracted: any, intent: string): FieldResult[] {
  const item = extracted?.items?.[0] ?? {};
  const results: FieldResult[] = [];

  const add = (
    field: string,
    expected: string,
    actual: string,
    ok: boolean,
    scored = true,
  ) => results.push({ field, expected, actual, ok, scored });

  // Intent is always asserted.
  add(
    'intent',
    row.expected_intent,
    intent,
    norm(row.expected_intent) === norm(intent),
  );

  // Remaining fields are only scored when the label states an expectation.
  if (row.expected_product) {
    add(
      'product',
      row.expected_product,
      String(item.matched_product_name ?? ''),
      productMatches(row.expected_product, item.matched_product_name),
    );
  }

  if (row.expected_quantity) {
    add(
      'quantity',
      row.expected_quantity,
      String(item.quantity ?? ''),
      String(item.quantity ?? '') === row.expected_quantity,
    );
  }

  if (row.expected_size) {
    const size = item.selected_attributes?.size;
    add('size', row.expected_size, String(size ?? ''), norm(size) === norm(row.expected_size));
  }

  if (row.expected_color) {
    const color = item.selected_attributes?.color;
    add(
      'color',
      row.expected_color,
      String(color ?? ''),
      norm(color) === norm(row.expected_color),
    );
  }

  if (row.expected_address) {
    const addr = extracted?.delivery_info?.address;
    add(
      'address',
      row.expected_address,
      String(addr ?? ''),
      norm(addr).includes(norm(row.expected_address)),
    );
  }

  if (row.expected_missing) {
    const expectedMissing = row.expected_missing
      .split('|')
      .map(norm)
      .filter(Boolean);
    const actualMissing: string[] = (extracted?.missing_fields ?? []).map(norm);
    add(
      'missing_fields',
      expectedMissing.join('|'),
      actualMissing.join('|'),
      expectedMissing.every((m) => actualMissing.includes(m)),
    );
  }

  return results;
}

// ── Runner ───────────────────────────────────────────────────────


/**
 * Fail loudly when the provider did not return anything usable.
 *
 * Without this the empty string from a failed call reaches JSON.parse and
 * surfaces as "Unexpected end of JSON input" — indistinguishable from the
 * model emitting malformed output. Seven of twenty-four rows failed that way
 * on the first real run, which made a rate-limit problem look like poor
 * extraction accuracy.
 */
function assertUsable(
  res: { success: boolean; text: string; error?: string },
  stage: string,
): void {
  if (!res.success) {
    throw new Error(`${stage} call failed: ${res.error ?? 'unknown error'}`);
  }

  if (!res.text?.trim()) {
    throw new Error(`${stage} call returned an empty response`);
  }
}

/**
 * The free tier rate-limits per minute, and this harness fires two calls per
 * row as fast as it can. Pacing keeps a measurement run from measuring the
 * rate limiter instead of the model.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  const argValue = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const verbose = args.includes('--verbose');
  const limit = Number(argValue('limit') ?? '0');
  const datasetPath = argValue('dataset') ?? 'eval/dataset.csv';

  // Same default as AiEngineModule: groq unless explicitly set to gemini.
  const provider = (process.env.AI_PROVIDER ?? 'groq').toLowerCase();

  const usingMock =
    provider === 'gemini'
      ? !process.env.GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE'
      : !process.env.GROQ_API_KEY ||
        process.env.GROQ_API_KEY === 'PASTE_YOUR_GROQ_KEY_HERE';

  console.log('\n═══ Extraction evaluation ═══\n');

  if (usingMock) {
    console.log(
      '⚠️  GEMINI_API_KEY is not set — the adapter will return canned mock\n' +
        '    output. These results measure THE MOCK, not the model, and must\n' +
        '    not be reported as extraction accuracy.\n',
    );
  }

  const rows = parseCsv(
    readFileSync(resolve(process.cwd(), datasetPath), 'utf8'),
  ) as unknown as EvalRow[];
  const subset = limit > 0 ? rows.slice(0, limit) : rows;

  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), 'eval/catalog.json'), 'utf8'),
  ) as { products: CatalogProduct[] };
  const catalogContext = formatCatalogContext(catalog.products);

  // Mirrors AiEngineModule's AI_ADAPTER factory. Hard-coding GeminiAdapter is
  // what made this harness report 0/24 against a working Groq key — it
  // measured the mock while the app itself used the real provider.
  const config = new ConfigService();
  const adapter: AiAdapter =
    provider === 'gemini' ? new GeminiAdapter(config) : new GroqAdapter(config);

  console.log(
    `Provider: ${provider}
Dataset: ${datasetPath}  (${subset.length} messages, ${catalog.products.length} catalog products)\n`,
  );

  const results: RowResult[] = [];

  // Groq's free tier allows 12,000 tokens/minute and one extraction call costs
  // roughly 950 (the catalogue context dominates), so ~6 rows/minute is the
  // ceiling. Pacing plus a longer backoff than the app's default keeps a
  // measurement run from measuring the rate limiter instead of the model.
  const pauseMs = Number(process.env.EVAL_PAUSE_MS ?? '9000');
  process.env.GROQ_RETRY_BASE_MS ??= '2500';
  process.env.GROQ_MAX_ATTEMPTS ??= '5';

  for (const row of subset) {
    try {
      await sleep(pauseMs);
      const intentRes = await adapter.generateText(
        INTENT_DETECTION_SYSTEM_PROMPT,
        INTENT_DETECTION_USER_PROMPT(row.message),
        { temperature: 0, jsonMode: true },
      );

      // A failed call returns success:false with empty text. Parsing that
      // throws "Unexpected end of JSON input", which reads like a model error
      // and is not one — it hid rate limiting behind a parse failure and made
      // the accuracy figure look worse than the model actually is.
      assertUsable(intentRes, 'intent');
      const intent =
        adapter.parseJsonResponse<{ intent: string }>(intentRes.text)?.intent ??
        '';

      const extractRes = await adapter.generateText(
        ENTITY_EXTRACTION_SYSTEM_PROMPT,
        ENTITY_EXTRACTION_USER_PROMPT(row.message, catalogContext),
        { temperature: 0.05, jsonMode: true },
      );

      assertUsable(extractRes, 'extraction');
      const extracted = adapter.parseJsonResponse<any>(extractRes.text);

      const fields = compare(row, extracted, intent);
      results.push({
        row,
        fields,
        passed: fields.every((f) => !f.scored || f.ok),
      });
    } catch (err) {
      results.push({
        row,
        fields: [],
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  report(results, verbose, usingMock);
}

function report(results: RowResult[], verbose: boolean, usingMock: boolean) {
  const pct = (n: number, d: number) =>
    d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1).padStart(5)}%`;

  // ── Per language ──
  console.log('── Accuracy by language ' + '─'.repeat(40));
  const byLang = new Map<string, RowResult[]>();
  for (const r of results) {
    const key = r.row.language || 'unknown';
    byLang.set(key, [...(byLang.get(key) ?? []), r]);
  }

  for (const [lang, rs] of [...byLang.entries()].sort()) {
    const passed = rs.filter((r) => r.passed).length;
    console.log(
      `  ${lang.padEnd(10)} ${String(passed).padStart(3)}/${String(rs.length).padEnd(3)}  ${pct(passed, rs.length)}`,
    );
  }

  // ── Per field ──
  console.log('\n── Accuracy by field ' + '─'.repeat(43));
  const fieldStats = new Map<string, { ok: number; total: number }>();
  for (const r of results) {
    for (const f of r.fields) {
      if (!f.scored) continue;
      const s = fieldStats.get(f.field) ?? { ok: 0, total: 0 };
      s.total++;
      if (f.ok) s.ok++;
      fieldStats.set(f.field, s);
    }
  }
  for (const [field, s] of [...fieldStats.entries()].sort()) {
    console.log(
      `  ${field.padEnd(16)} ${String(s.ok).padStart(3)}/${String(s.total).padEnd(3)}  ${pct(s.ok, s.total)}`,
    );
  }

  // ── Failures ──
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log('\n── Failures ' + '─'.repeat(52));
    for (const f of failures) {
      console.log(`\n  [${f.row.id}] ${f.row.language}  "${f.row.message}"`);
      if (f.row.notes) console.log(`      note: ${f.row.notes}`);
      if (f.error) {
        console.log(`      ERROR: ${f.error}`);
        continue;
      }
      for (const field of f.fields.filter((x) => x.scored && !x.ok)) {
        console.log(
          `      ${field.field.padEnd(14)} expected "${field.expected}"  got "${field.actual}"`,
        );
      }
    }
  }

  if (verbose) {
    console.log('\n── All rows ' + '─'.repeat(52));
    for (const r of results) {
      console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  [${r.row.id}] ${r.row.message}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  console.log('\n' + '═'.repeat(64));
  console.log(
    `  OVERALL  ${passed}/${results.length}  ${pct(passed, results.length)}` +
      (usingMock ? '   ← MOCK OUTPUT, NOT A REAL ACCURACY FIGURE' : ''),
  );
  console.log('═'.repeat(64) + '\n');

  if (usingMock) {
    console.log(
      'Set GEMINI_API_KEY and re-run to measure the actual model.\n' +
        'Replace eval/dataset.csv with real customer messages to measure\n' +
        'against real traffic — see eval/README.md.\n',
    );
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
