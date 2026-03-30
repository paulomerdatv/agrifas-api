import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupportTicketStatus, TicketMessageSender } from '@prisma/client';

interface CreateTicketInput {
  reason?: string;
  title?: string;
  message?: string;
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(userId: string, input: CreateTicketInput) {
    const reason = this.requireText(input.reason, 'Motivo');
    const title = this.requireText(input.title, 'Titulo');
    const message = this.requireText(input.message, 'Mensagem');

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        reason,
        title,
        status: SupportTicketStatus.OPEN,
        messages: {
          create: {
            sender: TicketMessageSender.USER,
            message,
          },
        },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return ticket;
  }

  async getMyTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
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

  async addUserMessage(userId: string, ticketId: string, messageRaw?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, status: true },
    });

    if (!ticket) {
      throw new NotFoundException('Chamado nao encontrado.');
    }

    if (ticket.userId !== userId) {
      throw new ForbiddenException('Este chamado nao pertence ao usuario atual.');
    }

    if (ticket.status === SupportTicketStatus.CONCLUDED) {
      throw new BadRequestException('Chamado concluido. Abra um novo ticket.');
    }

    const message = this.requireText(messageRaw, 'Mensagem');

    await this.prisma.supportTicketMessage.create({
      data: {
        ticketId,
        sender: TicketMessageSender.USER,
        message,
      },
    });

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: SupportTicketStatus.OPEN,
      },
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

  private requireText(value: string | undefined, label: string) {
    const normalized = (value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${label} e obrigatorio.`);
    }

    if (normalized.length > 1000) {
      throw new BadRequestException(`${label} excede o limite permitido.`);
    }

    return normalized;
  }
}
