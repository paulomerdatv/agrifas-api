import { Controller, Get } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

@Controller('public/campaigns')
export class PublicCampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get('active')
  async getActiveCampaign() {
    return this.campaignsService.getActivePublicCampaign();
  }
}

