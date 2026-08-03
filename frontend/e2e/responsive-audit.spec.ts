import { test, expect, Page } from '@playwright/test';
import { registerTestTenant, seedAuth } from './helpers';

/**
 * Responsive audit.
 *
 * The stylesheet had exactly one breakpoint in 444 lines, and it only reflowed
 * data tables — nothing for the shell, header or dropdowns. This measures the
 * result rather than eyeballing it: any element wider than the viewport, and
 * any tap target below the 44px minimum, is a defect a phone user hits
 * immediately.
 *
 * 360px is the real floor. A large share of Sri Lankan Android handsets report
 * a 360px CSS viewport, and this product is sold to shop owners running it on
 * exactly those phones.
 */

const VIEWPORTS = [
  { name: 'small-android', width: 360, height: 740 },
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
];

const PAGES = [
  '/dashboard',
  '/dashboard/orders',
  '/dashboard/products',
  '/dashboard/customers',
  '/dashboard/ai-performance',
  '/dashboard/settings',
];

/** Elements sticking out past the viewport — the cause of the sideways scroll. */
async function findOverflow(page: Page, viewportWidth: number) {
  return page.evaluate((vw) => {
    const offenders: { tag: string; cls: string; right: number; text: string }[] =
      [];

    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;

      // A closed drawer is *meant* to sit off-canvas; flagging it would hide
      // the real defects behind noise. Skip anything parked entirely to the
      // left of the viewport, and anything inside it.
      if (r.right <= 0) return;
      if (el.closest('.mobile-sidebar')) return;

      // Content inside a container that scrolls horizontally on purpose — a
      // tab strip, a wide table — is reachable, not broken. Only content that
      // escapes the page itself is a defect.
      let p: HTMLElement | null = el.parentElement;
      let inScroller = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') { inScroller = true; break; }
        p = p.parentElement;
      }
      if (inScroller) return;

      // 1px of tolerance for sub-pixel rounding.
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls:
            typeof el.className === 'string'
              ? el.className.slice(0, 40)
              : '(svg)',
          right: Math.round(r.right),
          text: (el.textContent ?? '').trim().slice(0, 30),
        });
      }
    });

    return offenders.slice(0, 12);
  }, viewportWidth);
}

/** Interactive elements below the 44px minimum recommended for touch. */
async function findSmallTapTargets(page: Page) {
  return page.evaluate(() => {
    const small: { tag: string; label: string; w: number; h: number }[] = [];

    document
      .querySelectorAll('button, a[href], input, select, [role="button"]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;

        if (r.height < 44 || r.width < 44) {
          small.push({
            tag: el.tagName.toLowerCase(),
            label: (
              el.getAttribute('aria-label') ??
              el.textContent ??
              ''
            )
              .trim()
              .slice(0, 24),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      });

    return small.slice(0, 12);
  });
}

test.describe('Responsive audit', () => {
  for (const vp of VIEWPORTS) {
    test(`no horizontal overflow at ${vp.width}px (${vp.name})`, async ({
      page,
    }) => {
      const tenant = await registerTestTenant();
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await seedAuth(page, tenant);

      const report: string[] = [];

      for (const path of PAGES) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        // The dashboard holds an SSE stream open, so networkidle never fires.
        await page.waitForTimeout(1200);

        // The definitive symptom: the page scrolls sideways.
        const scrollable = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth + 1,
        );

        const offenders = await findOverflow(page, vp.width);

        if (scrollable || offenders.length) {
          report.push(
            `${path}  scrolls=${scrollable}  offenders=${offenders
              .map((o) => `${o.tag}.${o.cls}@${o.right}px "${o.text}"`)
              .join(' | ')}`,
          );
        }
      }

      expect(report, `Horizontal overflow at ${vp.width}px:\n${report.join('\n')}`)
        .toHaveLength(0);
    });
  }

  test('tap targets meet the 44px minimum at 360px', async ({ page }) => {
    const tenant = await registerTestTenant();
    await page.setViewportSize({ width: 360, height: 740 });
    await seedAuth(page, tenant);

    const report: string[] = [];

    for (const path of ['/dashboard', '/dashboard/products']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);

      const small = await findSmallTapTargets(page);
      if (small.length) {
        report.push(
          `${path}: ${small.map((s) => `${s.tag}"${s.label}"(${s.w}x${s.h})`).join(', ')}`,
        );
      }
    }

    expect(report, `Tap targets under 44px:\n${report.join('\n')}`).toHaveLength(
      0,
    );
  });

  test('the notifications panel stays inside the viewport at 360px', async ({
    page,
  }) => {
    // The reported bug: the panel is positioned `right: 0` against the button
    // but sized `calc(100vw - 32px)`, so its left edge runs off-screen and the
    // text is clipped.
    const tenant = await registerTestTenant();
    await page.setViewportSize({ width: 360, height: 740 });
    await seedAuth(page, tenant);

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    const bell = page.locator('button[aria-label*="otification" i]').first();
    await bell.click();

    // Measure the panel itself. Locating by its text and walking up with
    // closest('div') finds the header row inside the panel, not the panel.
    const box = await page.locator('.header-panel').first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    });

    expect(box.left, `panel left edge is off-screen (${box.left}px)`).toBeGreaterThanOrEqual(0);
    expect(box.right, `panel right edge overflows (${box.right}px)`).toBeLessThanOrEqual(360);
  });
});
