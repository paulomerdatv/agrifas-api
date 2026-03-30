import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SupportService } from './support.service';

@Controller('support/live')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('status')
  getStatus() {
    return this.supportService.getLiveStatus();
  }

  @Post('session')
  createSession(
    @Body()
    body: {
      userId?: string;
      name?: string;
      email?: string;
    },
  ) {
    return this.supportService.createSession(body || {});
  }

  @Get(':sessionId/messages')
  getMessages(@Param('sessionId') sessionId: string) {
    return this.supportService.listMessages(sessionId);
  }

  @Post(':sessionId/messages')
  sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: { message?: string },
  ) {
    return this.supportService.sendUserMessage(sessionId, body?.message || '');
  }
}
