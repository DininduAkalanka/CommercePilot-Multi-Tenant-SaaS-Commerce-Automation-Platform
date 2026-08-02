import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConversationsService } from './conversations.service';
import { ConversationStateService } from './conversation-state.service';
import { IoRedisAdapter } from './adapters/ioredis.adapter';
import { REDIS_SERVICE } from './interfaces/redis-service.interface';
import { ConversationsProcessor } from './conversations.processor';
import { HumanHandoffService } from './human-handoff.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'message-processing',
    }),
    forwardRef(() => WhatsAppModule),
  ],
  providers: [
    {
      provide: REDIS_SERVICE,
      useClass: IoRedisAdapter,
    },
    ConversationStateService,
    ConversationsService,
    ConversationsProcessor,
    HumanHandoffService,
  ],
  exports: [
    ConversationsService,
    ConversationStateService,
    HumanHandoffService,
    BullModule,
  ],
})
export class ConversationsModule {}
