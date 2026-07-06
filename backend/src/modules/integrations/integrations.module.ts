import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { ProductSyncService } from './services/product-sync.service';
import { OrderSyncService } from './services/order-sync.service';
import { WooCommerceAdapter } from './adapters/woocommerce.adapter';
import { ECOMMERCE_ADAPTER } from './interfaces/ecommerce-adapter.interface';
import { DatabaseModule } from '../../common/database/database.module';
import { AiEngineModule } from '../ai-engine/ai-engine.module'; // for ProductRetrieverService

@Module({
  imports: [DatabaseModule, AiEngineModule],
  controllers: [IntegrationsController],
  providers: [
    ProductSyncService,
    OrderSyncService,
    {
      provide: ECOMMERCE_ADAPTER,
      useClass: WooCommerceAdapter,
    },
  ],
  exports: [ProductSyncService, OrderSyncService, ECOMMERCE_ADAPTER],
})
export class IntegrationsModule {}
