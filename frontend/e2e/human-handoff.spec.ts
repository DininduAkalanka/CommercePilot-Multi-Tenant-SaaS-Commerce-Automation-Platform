import { test, expect, request as playwrightRequest } from '@playwright/test';
import { registerTestTenant } from './helpers';

const API = 'http://localhost:3001/api/v1';

/**
 * Before this existed, a customer the AI could not understand was asked to
 * clarify forever. Nothing counted the attempts, so the conversation had no
 * exit — the customer simply gave up and the business never learned it had
 * lost the order.
 *
 * Asserting on the OWNER NOTIFICATION rather than the outbound WhatsApp text
 * is deliberate: bot replies are appended to the Redis session only and are
 * not exposed by any endpoint, and the notification is the thing that actually
 * has to happen — a handoff nobody is told about is not a handoff.
 */
test.describe('Human handoff', () => {
  /** Triggers ORDER intent in the mock extractor but can never be completed:
   *  a fresh tenant has an empty catalog, so no product can match, and there
   *  is no digit to read as a quantity. */
  const UNRESOLVABLE = 'mata shirt one';

  const notificationTitles = async (token: string): Promise<string[]> => {
    const ctx = await playwrightRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get(`${API}/notifications?limit=50`);
    const body = await res.json();
    await ctx.dispose();

    return (body?.data?.items ?? []).map(
      (n: { title?: string }) => n.title ?? '',
    );
  };

  test('escalates to a human after repeated failed clarifications', async () => {
    const tenant = await registerTestTenant();
    const ctx = await playwrightRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${tenant.accessToken}` },
    });
    const phone = `+9477${Date.now().toString().slice(-7)}`;

    // First two attempts: the AI is allowed to ask for clarification.
    for (let i = 0; i < 2; i++) {
      const res = await ctx.post(`${API}/whatsapp/simulator/send`, {
        data: { phone, message: UNRESOLVABLE },
      });
      expect(res.ok()).toBeTruthy();
    }

    expect(await notificationTitles(tenant.accessToken)).not.toContainEqual(
      expect.stringContaining('needs a human'),
    );

    // Third: it has now failed twice and must stop asking.
    const third = await ctx.post(`${API}/whatsapp/simulator/send`, {
      data: { phone, message: UNRESOLVABLE },
    });
    expect(third.ok()).toBeTruthy();

    expect(await notificationTitles(tenant.accessToken)).toContainEqual(
      expect.stringContaining('needs a human'),
    );

    await ctx.dispose();
  });

  test('notifies the owner only once, however long the customer keeps typing', async () => {
    const tenant = await registerTestTenant();
    const ctx = await playwrightRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${tenant.accessToken}` },
    });
    const phone = `+9479${Date.now().toString().slice(-7)}`;

    for (let i = 0; i < 6; i++) {
      await ctx.post(`${API}/whatsapp/simulator/send`, {
        data: { phone, message: UNRESOLVABLE },
      });
    }

    const handoffs = (await notificationTitles(tenant.accessToken)).filter((t) =>
      t.includes('needs a human'),
    );

    // Escalation is idempotent — six failed messages must not mean six emails.
    expect(handoffs).toHaveLength(1);

    await ctx.dispose();
  });

  test('does not escalate a conversation the AI handles fine', async () => {
    const tenant = await registerTestTenant();
    const ctx = await playwrightRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${tenant.accessToken}` },
    });
    const phone = `+9478${Date.now().toString().slice(-7)}`;

    await ctx.post(`${API}/whatsapp/simulator/send`, {
      data: { phone, message: 'hello' },
    });

    // Escalating on everything would be as useless as never escalating.
    expect(await notificationTitles(tenant.accessToken)).not.toContainEqual(
      expect.stringContaining('needs a human'),
    );

    await ctx.dispose();
  });
});
