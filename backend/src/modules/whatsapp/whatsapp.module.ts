import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp.adapter';
import { MetaWhatsAppAdapter } from './adapters/meta-whatsapp.adapter';
import { WHATSAPP_ADAPTER } from './interfaces/whatsapp-adapter.interface';
import { AiEngineModule } from '../ai-engine/ai-engine.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsAppNotificationListener } from './whatsapp-notification.listener';

@Module({
  imports: [AiEngineModule, forwardRef(() => ConversationsModule)],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppNotificationListener,
    // Dynamic adapter selection based on WHATSAPP_PROVIDER env var
    {
      provide: WHATSAPP_ADAPTER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('WHATSAPP_PROVIDER', 'mock');
        if (provider === 'meta') {
          return new MetaWhatsAppAdapter(configService);
        }
        // Default: simulator/mock (no real Meta account required).
        return new MockWhatsAppAdapter();
      },
      inject: [ConfigService],
    },
  ],
  exports: [WhatsAppService, WHATSAPP_ADAPTER],
})
export class WhatsAppModule {}
