import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  SupportTicketStatus,
  TicketMessageSender,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminOperationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('orders')
  async getOrders() {
    return this.prisma.order.findMany({
      include: {
        raffle: {
          select: {
            id: true,
            title: true,
            image: true,
            pricePerTicket: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Delete('orders/:id/customer-data')
  async deleteOrderCustomerData(@Param('id') id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    await this.prisma.order.update({
      where: { id },
      data: {
        customerFullName: null,
        customerEmail: null,
        customerWhatsapp: null,
        customerTradeLink: null,
        customerCpfCnpj: null,
      },
    });

    return {
      success: true,
      message: 'Dados do comprador removidos com sucesso.',
    };
  }

  @Get('support/tickets')
  async getAllSupportTickets() {
    return this.prisma.supportTicket.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Post('support/tickets/:id/reply')
  async replySupportTicket(
    @Param('id') ticketId: string,
    @Body() body: { message?: string },
  ) {
    const message = (body?.message || '').trim();
    if (!message) {
      throw new BadRequestException('Mensagem e obrigatoria.');
    }

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });

    if (!ticket) {
      throw new NotFoundException('Chamado nao encontrado.');
    }

    if (ticket.status === SupportTicketStatus.CONCLUDED) {
      throw new BadRequestException('Chamado concluido. Reabra via novo ticket.');
    }

    await this.prisma.supportTicketMessage.create({
      data: {
        ticketId,
        sender: TicketMessageSender.ADMIN,
        message,
      },
    });

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: SupportTicketStatus.ANSWERED },
    });

    return this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  @Patch('support/tickets/:id/conclude')
  async concludeSupportTicket(@Param('id') ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });

    if (!ticket) {
      throw new NotFoundException('Chamado nao encontrado.');
    }

    if (ticket.status === SupportTicketStatus.CONCLUDED) {
      return {
        success: true,
        message: 'Chamado ja estava concluido.',
      };
    }

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: SupportTicketStatus.CONCLUDED,
        concludedAt: new Date(),
      },
    });

    return {
      success: true,
      message: 'Chamado concluido com sucesso.',
    };
  }

  @Delete('support/tickets/:id')
  async deleteSupportTicket(@Param('id') ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });

    if (!ticket) {
      throw new NotFoundException('Chamado nao encontrado.');
    }

    await this.prisma.supportTicket.delete({
      where: { id: ticketId },
    });

    return {
      success: true,
      message: 'Chamado excluido com sucesso.',
    };
  }

  @Get('winners')
  async getWinnersForAdmin() {
    return this.prisma.winner.findMany({
      include: {
        raffle: {
          select: {
            id: true,
            title: true,
            image: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNsu: true,
            selectedTickets: true,
          },
        },
      },
      orderBy: { drawnAt: 'desc' },
    });
  }
}
