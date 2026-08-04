import { test, expect, request as playwrightRequest } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';

/**
 * Routes that must never be rate limited, and a regression guard for how
 * easily that exemption can be lost.
 *
 * `@SkipThrottle()` with no argument defaults to `{ default: true }` in
 * @nestjs/throttler 6.x — it skips a throttler NAMED "default". This app's
 * throttlers are named "short" and "long", so the bare decorator skipped
 * nothing and these routes were rate limited at 10 req/s despite carrying the
 * decorator and a comment explaining why they must not be.
 *
 * Nothing caught it: the code read correctly, types passed, and every unit
 * test passed. It only appeared under concurrent load, which is why this test
 * bursts rather than sending a single request.
 *
 * What it costs when it regresses:
 *   - Health checks 429 → the platform judges the service unhealthy and
 *     restarts it, which looks like random downtime.
 *   - WhatsApp webhooks 429 → Meta delivers in bursts, so real customer
 *     messages are dropped. For an order-taking product that is lost revenue
 *     with no trace.
 */
test.describe('Throttle exemptions', () => {
  /** Comfortably above the 10 req/s short-window limit. */
  const BURST = 40;

  test('the liveness probe survives a burst', async () => {
    const ctx = await playwrightRequest.newContext();

    const codes = await Promise.all(
      Array.from({ length: BURST }, async () => {
        const res = await ctx.get(`${API}/health`);
        return res.status();
      }),
    );

    const throttled = codes.filter((c) => c === 429);
    expect(
      throttled,
      `${throttled.length}/${BURST} health checks were rate limited — the ` +
        'platform will treat this service as unhealthy and restart it',
    ).toHaveLength(0);
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  test('the readiness probe survives a burst', async () => {
    const ctx = await playwrightRequest.newContext();

    const codes = await Promise.all(
      Array.from({ length: BURST }, async () => {
        const res = await ctx.get(`${API}/health/ready`);
        return res.status();
      }),
    );

    expect(codes.filter((c) => c === 429)).toHaveLength(0);
  });

  test('the WhatsApp webhook survives a burst', async () => {
    // Meta batches messages, so a busy shop produces exactly this shape of
    // traffic. A 429 here is a customer whose order was never seen.
    const ctx = await playwrightRequest.newContext();

    const codes = await Promise.all(
      Array.from({ length: BURST }, async () => {
        const res = await ctx.get(
          `${API}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`,
        );
        return res.status();
      }),
    );

    const throttled = codes.filter((c) => c === 429);
    expect(
      throttled,
      `${throttled.length}/${BURST} webhook calls were rate limited — Meta ` +
        'delivers in bursts, so this drops real customer messages',
    ).toHaveLength(0);
  });

  test('ordinary API routes ARE still throttled', async () => {
    // The exemption must stay narrow. If this ever passes, the throttle has
    // been disabled globally rather than exempted for two routes.
    const ctx = await playwrightRequest.newContext();

    const codes = await Promise.all(
      Array.from({ length: 60 }, async () => {
        const res = await ctx.get(`${API}/products`);
        return res.status();
      }),
    );

    expect(
      codes.filter((c) => c === 429).length,
      'no request was throttled — the global rate limit is not protecting the API',
    ).toBeGreaterThan(0);
  });
});
