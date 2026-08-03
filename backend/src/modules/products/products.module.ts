import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductVariantModule } from './product-variant.module';
import { AiEngineModule } from '../ai-engine/ai-engine.module';

@Module({
  imports: [AiEngineModule, ProductVariantModule], // Import AiEngineModule to use ProductRetrieverService for embeddings
  controllers: [ProductsController],
  // ProductVariantService is exported but not yet wired into the order
  // pipeline — that is PR3. PR1 only puts the table and a tested, tenant-safe
  // way to manage it in place, so nothing observable changes on deploy.
  providers: [ProductsService],
  exports: [ProductsService, ProductVariantModule],
})
export class ProductsModule {}
