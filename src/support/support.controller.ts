import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('support/tickets')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('public')
  createPublicTicket(
    @Body()
    body: {
      name?: string;
      email?: string;
      reason?: string;
      title?: string;
      message?: string;
    },
  ) {
    return this.supportService.createPublicTicket(body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  createTicket(
    @Body()
    body: {
      reason?: string;
      title?: string;
      message?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.supportService.createTicket(user.userId, body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyTickets(@CurrentUser() user: any) {
    return this.supportService.getMyTickets(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/messages')
  addTicketMessage(
    @Param('id') ticketId: string,
    @Body() body: { message?: string },
    @CurrentUser() user: any,
  ) {
    return this.supportService.addUserMessage(
      user.userId,
      ticketId,
      body?.message,
    );
  }
}
