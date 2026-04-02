import { Module } from '@nestjs/common';
import { AdminCampaignsController } from './admin-campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { PublicCampaignsController } from './public-campaigns.controller';

@Module({
  controllers: [AdminCampaignsController, PublicCampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}

