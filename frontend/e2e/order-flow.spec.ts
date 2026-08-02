import { test, expect } from '@playwright/test';
import { registerTestTenant, seedAuth } from './helpers';

/**
 * Core business flow (PRD "MVP success criterion"):
 *   WhatsApp message -> AI draft -> owner review/correction -> approval
 *   -> order created & synced.
 *
 * Runs against a freshly-registered, throwaway tenant (MOCK WhatsApp +
 * WooCommerce providers by default), so it's fully self-contained — no
 * external services, no shared state with other tests or manual sessions.
 *
 * Note on MOCK AI: with no GEMINI_API_KEY configured, the AI engine returns a
 * fixed canned extraction rather than truly matching the message against the
 * tenant's catalog (real extraction is exercised in Phase 7's live-store
 * verification with WooCommerce). This test therefore drives the same
 * "owner corrects a mismatched draft" path a real user takes when the AI
 * gets it wrong — exercising the correction UI, not assuming a lucky match.
 */
test.describe('Core order flow', () => {
  test('simulator message -> AI draft -> owner correction -> approval -> order synced', async ({ page }) => {
    const tenant = await registerTestTenant();
    await seedAuth(page, tenant);

    // ── Add a real, in-stock product for the owner to (re-)assign during correction ──
    await page.goto('/dashboard/products');
    // `.first()` is required: the page renders an "Add product" button in the
    // header AND another inside the empty-state card, and a freshly registered
    // E2E tenant always has an empty catalog — so both are present and a bare
    // getByRole is a strict-mode violation. The header button is first in DOM
    // order; both open the same modal.
    await page
      .getByRole('button', { name: /add product/i })
      .first()
      .click();
    await page.getByPlaceholder('e.g. White School Shirt').fill('E2E Test Widget');
    await page.getByPlaceholder('0.00').fill('25.00');
    // Stock Quantity has no placeholder — it's the 2nd number input in the modal
    // (1st is Price). Must be > 0 or approval correctly rejects for insufficient stock.
    await page.locator('.modal-content input[type="number"]').nth(1).fill('10');
    await page.getByRole('button', { name: /save product/i }).click();
    await expect(page.getByText('E2E Test Widget')).toBeVisible({ timeout: 5000 });

    // ── Send a WhatsApp simulator message ───────────────────────
    await page.goto('/dashboard/simulator');
    await page.getByPlaceholder('Type a customer message...').fill('I want to order 1 E2E Test Widget please');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('I want to order 1 E2E Test Widget please')).toBeVisible({
      timeout: 5000,
    });

    // ── A draft should appear in the Pending Drafts tab ─────────
    await page.goto('/dashboard/orders');
    await expect(page.getByRole('button', { name: 'Pending Drafts' })).toBeVisible();
    const draftCard = page.locator('.glass-card', { hasText: 'Approve' });
    await expect(draftCard).toBeVisible({ timeout: 15_000 }); // async AI pipeline via BullMQ

    // ── Open the draft, correct the (mock-AI) product match, and approve ──
    await draftCard.click();
    await page.getByRole('button', { name: 'Edit Details' }).click();
    await page.locator('select.select').first().selectOption({ label: 'E2E Test Widget ($25.00)' });
    await page.getByRole('button', { name: /Edit \+ Approve|Approve Draft/ }).click();

    // Panel closes and the draft list returns to empty.
    await expect(page.getByText('All caught up!')).toBeVisible({ timeout: 10_000 });

    // ── The approved order should now show up under All Orders ──
    await page.getByRole('button', { name: 'All Orders' }).click();
    await expect(page.locator('table.data-table')).toBeVisible({ timeout: 5000 });
    // Status should be either SYNCED (mock WooCommerce succeeds instantly)
    // or APPROVED (if sync is still processing) — never left as PENDING_AI.
    await expect(page.locator('td', { hasText: /Synced|Approved/ }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
