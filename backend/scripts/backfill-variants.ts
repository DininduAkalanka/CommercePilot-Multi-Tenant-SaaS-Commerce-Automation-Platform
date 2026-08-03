/**
 * Phase 1 PR2 — variant backfill.
 *
 * Gives every product without variants a single "default" variant carrying its
 * current stock, so `product_variants` becomes a complete mirror of
 * `products.stockQuantity`. Nothing reads variants yet; PR3 switches the
 * readers over once this has run and the mirror is known good.
 *
 * Safe to run repeatedly. It selects only products with NO variants at all, so
 * re-running reconciles anything a failed dual-write missed without disturbing
 * products that already have real size/colour variants.
 *
 * Deliberately a manual script rather than an automatic migration step. It
 * writes one row per product across every tenant, and that is not something to
 * run implicitly on each deploy — it should be run once, watched, and re-run
 * only when reconciling.
 *
 *   npm run backfill:variants              # every tenant
 *   npm run backfill:variants -- <tenantId>  # one tenant
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ProductVariantService } from '../src/modules/products/product-variant.service';

async function main(): Promise<void> {
  const logger = new Logger('BackfillVariants');
  const tenantId = process.argv[2];

  // Logs only — the app's own bootstrap noise is not useful here.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const variants = app.get(ProductVariantService);

    logger.log(
      tenantId
        ? `Backfilling default variants for tenant ${tenantId}`
        : 'Backfilling default variants for ALL tenants',
    );

    const started = Date.now();
    const { created, failed } = await variants.backfillDefaults(tenantId);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    logger.log(
      `Done in ${seconds}s — ${created} variants created, ${failed} failed`,
    );

    if (failed > 0) {
      logger.warn(
        'Some products could not be backfilled. Their stock is still correct ' +
          'in products.stockQuantity; re-run this script to reconcile before ' +
          'enabling variant reads (PR3).',
      );
    }

    // Non-zero exit on partial failure so CI or a deploy hook notices rather
    // than reporting success over a half-finished backfill.
    await app.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error: unknown) {
    logger.error(
      `Backfill aborted: ${error instanceof Error ? error.message : error}`,
    );
    await app.close();
    process.exit(1);
  }
}

void main();
