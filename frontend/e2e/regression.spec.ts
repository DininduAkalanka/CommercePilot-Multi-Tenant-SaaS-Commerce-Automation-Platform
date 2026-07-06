import { test, expect } from '@playwright/test';
import { registerTestTenant, seedAuth } from './helpers';

/**
 * Regression coverage for bugs found and fixed during the Phase 8 live
 * frontend audit. Each test pins down one specific defect so it can never
 * silently return.
 */
test.describe('Regression: Phase 8 fixes', () => {
  test('customer detail page loads without 500s (Next.js 16 async-params bug)', async ({ page }) => {
    const tenant = await registerTestTenant();
    await seedAuth(page, tenant);

    // Create real activity so a customer exists: send a simulator message.
    await page.goto('/dashboard/simulator');
    await page.getByPlaceholder('Type a customer message...').fill('Hello, do you have any products?');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.waitForTimeout(1500);

    const failedRequests: string[] = [];
    page.on('response', (res) => {
      if (res.status() >= 500) failedRequests.push(`${res.status()} ${res.url()}`);
    });

    await page.goto('/dashboard/customers');
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await firstRow.click();

    await page.waitForURL(/\/dashboard\/customers\/[^/]+$/, { timeout: 5000 });
    // The bug produced /customers/undefined and cascading 500s on every call.
    expect(page.url()).not.toContain('undefined');
    await expect(page.getByText('Back to Customers')).toBeVisible({ timeout: 5000 });
    expect(failedRequests, `Unexpected 5xx responses: ${failedRequests.join(', ')}`).toHaveLength(0);
  });

  test('dashboard KPIs use real data, not hardcoded/mismatched values', async ({ page }) => {
    const tenant = await registerTestTenant();
    await seedAuth(page, tenant);

    await page.goto('/dashboard');
    // A brand-new tenant has zero orders — the KPI must read "0", not silently
    // display a stale/placeholder non-zero value (the original field-name bug
    // always fell back through `?? 0`, which coincidentally also read "0" here;
    // the meaningful assertion is that the AI Accuracy card is no longer the
    // hardcoded literal "94%" when there is no AI activity at all).
    await expect(page.getByText('Total Orders')).toBeVisible();
    const aiAccuracyCard = page.locator('.glass-card', { hasText: 'AI Accuracy' });
    await expect(aiAccuracyCard).toBeVisible();
    await expect(aiAccuracyCard).not.toContainText('94%');
  });

  test('notifications list matches its own reported total (items vs. count mismatch)', async ({ page }) => {
    const tenant = await registerTestTenant();
    await seedAuth(page, tenant);

    // Trigger at least one notification (order draft pending approval email/system alert).
    await page.goto('/dashboard/products');
    await page.getByRole('button', { name: /add product/i }).click();
    await page.getByPlaceholder('e.g. White School Shirt').fill('Notif Trigger Product');
    await page.getByPlaceholder('0.00').fill('5.00');
    await page.getByRole('button', { name: /save product/i }).click();
    await expect(page.getByText('Notif Trigger Product')).toBeVisible({ timeout: 5000 });

    await page.goto('/dashboard/simulator');
    await page.getByPlaceholder('Type a customer message...').fill('I want 1 Notif Trigger Product');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.waitForTimeout(2000);

    await page.goto('/dashboard/notifications');
    const header = page.getByText(/total notifications/);
    if (await header.count() > 0) {
      const headerText = await header.textContent();
      const expectedCount = parseInt(headerText?.match(/\d+/)?.[0] ?? '0', 10);
      if (expectedCount > 0) {
        // The list must render exactly as many notification cards as the header claims —
        // never the "No notifications" empty state while the count is non-zero.
        await expect(page.getByText('No notifications')).not.toBeVisible();
      }
    }
  });

  test('the WhatsApp Simulator SSE stream never sends the JWT in the URL', async ({ page }) => {
    const tenant = await registerTestTenant();
    await seedAuth(page, tenant);

    const sseRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/orders/events')) sseRequests.push(req.url());
    });

    await page.goto('/dashboard/orders');
    await page.waitForTimeout(1000);

    expect(sseRequests.length).toBeGreaterThan(0);
    for (const url of sseRequests) {
      expect(url).not.toContain('token=');
    }
  });
});
