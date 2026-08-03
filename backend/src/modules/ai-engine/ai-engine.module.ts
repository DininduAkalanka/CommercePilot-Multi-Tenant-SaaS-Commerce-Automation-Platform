import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiEngineService } from './ai-engine.service';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { GroqAdapter } from './adapters/groq.adapter';
import { AI_ADAPTER, AiAdapter } from './adapters/ai-adapter.interface';
import { JinaEmbeddingProvider } from './adapters/jina-embedding.provider';
import { NullEmbeddingProvider } from './adapters/null-embedding.provider';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
} from './adapters/embedding-provider.interface';
import { IntentDetectorService } from './pipeline/intent-detector.service';
import { QueryNormalizerService } from './pipeline/query-normalizer.service';
import { ProductRetrieverService } from './pipeline/product-retriever.service';
import { EntityExtractorService } from './pipeline/entity-extractor.service';
import { ConfidenceScorerService } from './pipeline/confidence-scorer.service';
import { ConflictResolverService } from './pipeline/conflict-resolver.service';
import { AiMetricsService } from './ai-metrics.service';
import { AiMetricsController } from './ai-metrics.controller';
import { UnfulfilledDemandService } from './unfulfilled-demand.service';
import { DuplicateDetectorService } from './duplicate-detector.service';

@Module({
  controllers: [AiMetricsController],
  providers: [
    AiEngineService,
    // Both adapters stay registered so switching provider is an env change and
    // a restart, not a deploy.
    GeminiAdapter,
    GroqAdapter,
    {
      provide: AI_ADAPTER,
      inject: [ConfigService, GeminiAdapter, GroqAdapter],
      useFactory: (
        config: ConfigService,
        gemini: GeminiAdapter,
        groq: GroqAdapter,
      ): AiAdapter => {
        const provider = (
          config.get<string>('AI_PROVIDER') ?? 'groq'
        ).toLowerCase();
        const logger = new Logger('AiProvider');

        if (provider === 'gemini') {
          // Kept selectable: Gemini's free tier is region-gated (it returns
          // `limit: 0` in Sri Lanka), but a paid key makes it viable again,
          // and it is the only one of the two that can embed.
          logger.log('Using Gemini');
          return gemini;
        }

        if (provider !== 'groq') {
          logger.warn(
            `Unknown AI_PROVIDER "${provider}" — falling back to groq. ` +
              'Valid values: groq, gemini.',
          );
        } else {
          logger.log('Using Groq');
        }

        return groq;
      },
    },
    // Embeddings are selected separately from text generation: the two come
    // from different vendors now, and Groq has no embedding models at all.
    JinaEmbeddingProvider,
    NullEmbeddingProvider,
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService, JinaEmbeddingProvider, NullEmbeddingProvider],
      useFactory: (
        config: ConfigService,
        jina: JinaEmbeddingProvider,
        none: NullEmbeddingProvider,
      ): EmbeddingProvider => {
        const provider = (
          config.get<string>('EMBEDDING_PROVIDER') ?? 'none'
        ).toLowerCase();
        const logger = new Logger('EmbeddingProvider');

        if (provider === 'jina') {
          logger.log(`Using Jina (${jina.dimensions} dimensions)`);
          return jina;
        }

        // Defaults to none on purpose. Vector search then returns nothing and
        // retrieval falls back to text matching — correct and visible, rather
        // than silently ranking against vectors nobody configured.
        if (provider !== 'none') {
          logger.warn(
            `Unknown EMBEDDING_PROVIDER "${provider}" — falling back to none. ` +
              'Valid values: jina, none.',
          );
        } else {
          logger.log(
            'No embedding provider — product search uses text matching',
          );
        }

        return none;
      },
    },
    IntentDetectorService,
    QueryNormalizerService,
    ProductRetrieverService,
    EntityExtractorService,
    ConfidenceScorerService,
    ConflictResolverService,
    AiMetricsService,
    UnfulfilledDemandService,
    DuplicateDetectorService,
  ],
  exports: [AiEngineService, ProductRetrieverService, ConflictResolverService],
})
export class AiEngineModule {}
