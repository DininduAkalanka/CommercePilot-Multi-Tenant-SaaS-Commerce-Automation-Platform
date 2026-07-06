import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 *
 * Assumes the backend (http://localhost:3001) and its dependencies
 * (Postgres, Redis) are already running — see backend/docker-compose.yml.
 * The frontend dev server is started automatically via `webServer` below.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // tests register/mutate real backend state; keep sequential per file
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
