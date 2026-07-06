import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { AiEngineModule } from '../ai-engine/ai-engine.module';

@Module({
  imports: [AiEngineModule], // Import AiEngineModule to use ProductRetrieverService for embeddings
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
