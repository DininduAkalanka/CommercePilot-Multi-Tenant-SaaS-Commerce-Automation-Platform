# Extraction evaluation harness

Measures how accurately the AI reads a customer's WhatsApp message, broken
down by language.

```bash
npm run eval                                  # full dataset
npm run eval -- --limit 5                     # first 5 rows
npm run eval -- --verbose                     # show passes too
npm run eval -- --dataset eval/real.csv       # your own data
```

No database, Redis or tenant setup — it drives `GeminiAdapter` directly with
the production prompts, so it runs anywhere including CI.

---

## Read this before trusting a number

**Two things must be true for the output to mean anything.**

### 1. `GEMINI_API_KEY` must be set

Without it the adapter returns a canned mock response, and the eval measures
the mock rather than the model. The harness prints a warning and tags the
score when this happens. Today the deployment has no key, so a run scores
near zero — that is the mock being detected, not the model failing.

### 2. The dataset must be REAL customer messages

`eval/dataset.csv` ships with ~24 provisional rows so the harness is runnable
out of the box. **They are not a substitute for real data.**

> ⚠️ The Sinhala and Singlish rows were written as a non-native
> approximation. Real Singlish has spelling variation, slang and typos that no
> invented example reproduces. Treat these rows as a smoke test of the
> machinery, and have a native speaker review or replace them.

Synthetic data flatters the system: you unconsciously write clean, unambiguous
sentences, and the model scores well on messages no real customer would send.

---

## Collecting real data

**Target 200–300 messages. Start with 50** — enough to get a real number and
see which language is worst. 50 labelled messages this week beats 300 next
month.

### Where to get them

1. **Export chats from the business WhatsApp.** Open a customer chat →
   ⋮ → **More → Export chat → Without media**. Repeat for 20–40 customers.
2. **An existing store's message history**, if you have one.
3. The `whatsapp_messages` table — but note that while
   `WHATSAPP_PROVIDER=mock`, everything in it is simulator traffic someone
   typed by hand, not real customers.

### Anonymise first

These contain phone numbers and delivery addresses — Restricted data under
`SECURITY.md` §3. Before the file leaves WhatsApp:

- replace phone numbers with `+9477XXXXXXX`
- change street numbers and names

Keep the *shape* of the address (city, suburb) — the AI has to extract it.

### Two things that matter more than volume

**Match your real traffic mix.** If 70% of customers write Singlish, the file
should be ~70% Singlish. An eval set that is mostly English will report
success and then fail in production.

**Include the ugly cases on purpose.** Two products in one message, no product
named, "same as last time", someone changing their mind mid-sentence, bare
quantities. That is where extraction breaks — and where the human escape hatch
has to fire.

---

## Dataset format

| Column | Meaning |
|---|---|
| `id` | Any unique label, e.g. `sg-01` |
| `message` | **Exactly as typed** — typos, missing punctuation, all of it |
| `language` | `en` · `si` · `singlish` · `mixed` |
| `expected_intent` | `ORDER` · `INQUIRY` · `GREETING` · `COMPLAINT` |
| `expected_product` | Product they meant, e.g. `White School Shirt` |
| `expected_quantity` | `2` |
| `expected_size` | `L` |
| `expected_color` | `blue` |
| `expected_address` | `Nugegoda` |
| `expected_missing` | Fields genuinely not given, `\|`-separated |
| `notes` | Why the row is interesting |

**Leave a cell blank when the row does not assert that field** — blank means
"not scored", not "expected empty". Only `expected_intent` is always scored.

Commas inside a message are fine if the field is quoted:

```csv
mx-03,"frock 1k one red, Colombo 07 ta deliver karanna",mixed,ORDER,...
```

### Matching rules

- **product** — fuzzy, containment either direction, so
  `White School Shirt (S)` still matches `White School Shirt`
- **address** — the actual value must *contain* the expected one
- **missing_fields** — every expected field must be present; extras are allowed
- everything else — exact, case-insensitive

---

## `catalog.json`

The fixture catalog the model is grounded against, formatted identically to
`ProductRetrieverService.formatCatalogContext`.

Keep it small and realistic. **Replace it with products from your own store** —
the eval should measure matching against names your customers actually use.

If `formatCatalogContext` ever changes shape, update `formatCatalogContext` in
`run-eval.ts` to match, or the eval stops reflecting production.

---

## Using it

1. Get a `GEMINI_API_KEY` and set it.
2. Run `npm run eval` and record the baseline per language.
3. Change one thing — a prompt, a few-shot example, a normaliser.
4. Re-run. Keep the change only if the number moved.

That loop is what turns Phase 3 (Sinhala/Singlish) from guesswork into
engineering. Without it you cannot tell an improvement from a regression, and
you cannot demonstrate the PRD's 95% extraction-accuracy target.
