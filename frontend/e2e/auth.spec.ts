import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('a new business can register, land on the dashboard, log out, and log back in', async ({ page }) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `e2e-ui-${unique}@commercepilot-test.dev`;
    const password = 'Str0ng!Passw0rd';

    // ── Register via the real UI form ──────────────────────────
    await page.goto('/register');
    await page.getByPlaceholder("e.g. Nimal's Uniform Store").fill(`E2E UI Store ${unique}`);
    await page.getByPlaceholder('e.g. Nimal Perera').fill('E2E UI Tester');
    await page.getByPlaceholder('you@business.com').fill(email);
    await page.getByPlaceholder(/characters/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL('**/dashboard', { timeout: 10_000 });
    await expect(page.getByText('Operations Dashboard')).toBeVisible();

    // ── Log out ─────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await page.waitForURL('**/login', { timeout: 10_000 });

    // ── Log back in with the same credentials ──────────────────
    await page.getByPlaceholder('you@business.com').fill(email);
    await page.locator('input[type="password"], input[type="text"]').last().fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL('**/dashboard', { timeout: 10_000 });
    await expect(page.getByText('Operations Dashboard')).toBeVisible();
  });

  test('shows an error for invalid login credentials (never a raw 401/500)', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('you@business.com').fill('nonexistent@commercepilot-test.dev');
    await page.getByPlaceholder('Enter your password').fill('WrongPassword123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 5000 });
    // Must stay on the login page — no silent redirect on failure.
    await expect(page).toHaveURL(/\/login/);
  });
});
