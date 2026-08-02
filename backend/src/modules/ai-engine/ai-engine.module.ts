import { Module } from '@nestjs/common';
import { AiEngineService } from './ai-engine.service';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { IntentDetectorService } from './pipeline/intent-detector.service';
import { ProductRetrieverService } from './pipeline/product-retriever.service';
import { EntityExtractorService } from './pipeline/entity-extractor.service';
import { ConfidenceScorerService } from './pipeline/confidence-scorer.service';
import { ConflictResolverService } from './pipeline/conflict-resolver.service';
import { AiMetricsService } from './ai-metrics.service';
import { AiMetricsController } from './ai-metrics.controller';

@Module({
  controllers: [AiMetricsController],
  providers: [
    AiEngineService,
    GeminiAdapter,
    IntentDetectorService,
    ProductRetrieverService,
    EntityExtractorService,
    ConfidenceScorerService,
    ConflictResolverService,
    AiMetricsService,
  ],
  exports: [AiEngineService, ProductRetrieverService, ConflictResolverService],
})
export class AiEngineModule {}
