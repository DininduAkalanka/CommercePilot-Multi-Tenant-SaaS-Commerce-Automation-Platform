import { APIRequestContext, Page, request as playwrightRequest } from '@playwright/test';

const API_BASE_URL = 'http://localhost:3001/api/v1';

export interface TestTenant {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: string; tenantId: string; businessName: string };
}

/**
 * Registers a brand-new, throwaway tenant directly via the backend API.
 * Each call uses a unique email so tests are hermetic and never collide with
 * each other or with manually-created data. New tenants default to MOCK
 * WhatsApp/WooCommerce providers (see schema.prisma), so the full pipeline
 * runs deterministically without any external service.
 */
export async function registerTestTenant(api?: APIRequestContext): Promise<TestTenant> {
  const ctx = api ?? (await playwrightRequest.newContext());
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const res = await ctx.post(`${API_BASE_URL}/auth/register`, {
    data: {
      businessName: `E2E Test Store ${unique}`,
      ownerName: 'E2E Tester',
      email: `e2e-${unique}@commercepilot-test.dev`,
      password: 'Str0ng!Passw0rd',
    },
  });

  if (!res.ok()) {
    throw new Error(`Failed to register test tenant: ${res.status()} ${await res.text()}`);
  }

  const body = await res.json();
  return {
    email: `e2e-${unique}@commercepilot-test.dev`,
    password: 'Str0ng!Passw0rd',
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
    user: body.data.user,
  };
}

/**
 * Seeds the authenticated session into localStorage before the app loads,
 * matching what AuthProvider (lib/auth-context.tsx) expects on mount. Faster
 * and more focused than re-submitting the login form in every test — the
 * login form itself is covered separately in auth.spec.ts.
 */
export async function seedAuth(page: Page, tenant: TestTenant): Promise<void> {
  await page.addInitScript(
    ([token, refreshToken, user]) => {
      window.localStorage.setItem('commercepilot_token', token as string);
      window.localStorage.setItem('commercepilot_refresh_token', refreshToken as string);
      window.localStorage.setItem('commercepilot_user', user as string);
    },
    [tenant.accessToken, tenant.refreshToken, JSON.stringify(tenant.user)] as const,
  );
}
