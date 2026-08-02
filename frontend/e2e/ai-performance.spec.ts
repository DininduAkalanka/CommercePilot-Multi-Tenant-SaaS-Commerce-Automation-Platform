import { test, expect } from '@playwright/test';
import { registerTestTenant, seedAuth } from './helpers';

/**
 * The AI pipeline has always written a row to AIProcessingLog for every stage
 * — inputs, outputs, latency, confidence, success — and nothing ever read it.
 * "How many extractions failed yesterday?" had no answer.
 *
 * This exercises the whole telemetry loop end to end: the pipeline writes the
 * logs, the metrics endpoint aggregates them, and the page renders them.
 */
test.describe('AI Performance', () => {
  test('renders an empty state for a brand-new tenant', async ({ page }) => {
    const tenant = await registerTestTenant();
    await seedAuth(page, tenant);

    await page.goto('/dashboard/ai-performance');

    await expect(page.getByRole('heading', { name: 'AI Performance' })).toBeVisible();

    // A tenant with no traffic must render zeros, not crash or divide by zero.
    await expect(page.getByText('No pipeline activity in this period.')).toBeVisible();
    await expect(page.getByText('No failures — nothing to investigate.')).toBeVisible();
    await expect(page.getByText('Owner correction rate')).toBeVisible();
  });

  test('reflects real pipeline activity after a customer message', async ({ page }) => {
    const tenant = await registerTestTenant();
    await seedAuth(page, tenant);

    // Drive one message through the AI pipeline, which writes a log row per stage.
    await page.goto('/dashboard/simulator');
    await page
      .getByPlaceholder('Type a customer message...')
      .fill('I want to order 2 blue shirts');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('I want to order 2 blue shirts')).toBeVisible({
      timeout: 5000,
    });

    await page.goto('/dashboard/ai-performance');
    await expect(page.getByRole('heading', { name: 'AI Performance' })).toBeVisible();

    // The stage table should now list real runs. Processing is async via
    // BullMQ, so allow the pipeline time to land its rows.
    await expect(page.getByText('Intent Detection')).toBeVisible({ timeout: 15_000 });

    // Running without a GEMINI_API_KEY must be called out rather than letting
    // mock output be mistaken for real model quality.
    await expect(page.getByText(/used the mock extractor/i)).toBeVisible();
  });

  test('the metrics endpoint is not readable without a token', async ({ request }) => {
    const res = await request.get(
      'http://localhost:3001/api/v1/ai-engine/metrics',
    );

    expect(res.status()).toBe(401);
  });
});
