import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupportTicketStatus, TicketMessageSender } from '@prisma/client';
import * as bcrypt from 'bcrypt';

interface CreateTicketInput {
  reason?: string;
  title?: string;
  message?: string;
}

interface CreatePublicTicketInput extends CreateTicketInput {
  name?: string;
  email?: string;
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(userId: string, input: CreateTicketInput) {
    const reason = this.requireText(input.reason, 'Motivo');
    const title = this.requireText(input.title, 'Titulo');
    const message = this.requireText(input.message, 'Mensagem');

    return this.createTicketRecord(userId, reason, title, message);
  }

  async createPublicTicket(input: CreatePublicTicketInput) {
    const name = this.requireText(input.name, 'Nome');
    const email = this.requireEmail(input.email);
    const reason = this.requireText(input.reason, 'Motivo');
    const title = this.requireText(input.title, 'Titulo');
    const message = this.requireText(input.message, 'Mensagem');

    let user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      const randomPassword = `SUP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      user = await this.prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: 'USER',
        },
        select: { id: true },
      });
    }

    return this.createTicketRecord(user.id, reason, title, message);
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

  private async createTicketRecord(
    userId: string,
    reason: string,
    title: string,
    message: string,
  ) {
    return this.prisma.supportTicket.create({
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
  }

  private requireEmail(value: string | undefined) {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Email e obrigatorio.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalized)) {
      throw new BadRequestException('Email invalido.');
    }

    return normalized;
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
