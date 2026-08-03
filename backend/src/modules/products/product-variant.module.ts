import { Module } from '@nestjs/common';
import { ProductVariantService } from './product-variant.service';

/**
 * ProductVariantService lives in its own module because four modules need it
 * and two of them cannot import each other.
 *
 * `ProductsModule` already imports `AiEngineModule` (for embeddings), so
 * `AiEngineModule` importing `ProductsModule` back — which it needs for PR3's
 * stock reads in the conflict resolver — would be a dependency cycle.
 *
 * This module depends on nothing but the database and config, so anyone can
 * import it safely, and there is still exactly one instance rather than a
 * copy registered per consumer.
 */
@Module({
  providers: [ProductVariantService],
  exports: [ProductVariantService],
})
export class ProductVariantModule {}
