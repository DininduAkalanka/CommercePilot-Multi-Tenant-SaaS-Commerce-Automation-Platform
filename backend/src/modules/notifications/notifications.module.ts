import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationListener } from './notification.listener';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
