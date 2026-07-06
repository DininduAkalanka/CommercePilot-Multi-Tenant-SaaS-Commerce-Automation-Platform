import { Module } from '@nestjs/common';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettingsController } from './tenant-settings.controller';

@Module({
  controllers: [TenantSettingsController],
  providers: [TenantSettingsService],
  exports: [TenantSettingsService],
})
export class TenantSettingsModule {}
