import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

type SupportSender = 'user' | 'agent' | 'system';

export interface SupportMessage {
  id: string;
  sender: SupportSender;
  text: string;
  createdAt: string;
}

interface SupportSession {
  id: string;
  userId?: string;
  name?: string;
  email?: string;
  createdAt: string;
  lastActivityAt: string;
  messages: SupportMessage[];
}

interface CreateSessionInput {
  userId?: string;
  name?: string;
  email?: string;
}

@Injectable()
export class SupportService {
  private readonly sessions = new Map<string, SupportSession>();

  getLiveStatus() {
    const now = new Date();
    const hour = now.getHours();
    const online = hour >= 8 && hour < 23;
    const queuedSessions = Array.from(this.sessions.values()).filter((session) => {
      const diffMs =
        now.getTime() - new Date(session.lastActivityAt).getTime();
      return diffMs <= 1000 * 60 * 30;
    }).length;

    return {
      online,
      averageWaitMinutes: online ? Math.max(1, queuedSessions) : 12,
      queuedSessions,
      updatedAt: now.toISOString(),
      greeting: online
        ? 'Equipe online agora. Resposta inicial em poucos minutos.'
        : 'Equipe fora do horario. Deixe sua mensagem que responderemos assim que voltar.',
    };
  }

  createSession(input: CreateSessionInput) {
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    const firstMessage: SupportMessage = {
      id: randomUUID(),
      sender: 'system',
      text: 'Conexao iniciada. Em que podemos ajudar voce hoje?',
      createdAt: now,
    };

    const session: SupportSession = {
      id: sessionId,
      userId: input.userId,
      name: input.name?.trim() || undefined,
      email: input.email?.trim() || undefined,
      createdAt: now,
      lastActivityAt: now,
      messages: [firstMessage],
    };

    this.sessions.set(sessionId, session);

    return {
      sessionId,
      ...this.getLiveStatus(),
      messages: session.messages,
      createdAt: session.createdAt,
    };
  }

  listMessages(sessionId: string) {
    const session = this.getSession(sessionId);
    return {
      sessionId: session.id,
      ...this.getLiveStatus(),
      messages: session.messages,
      lastActivityAt: session.lastActivityAt,
    };
  }

  sendUserMessage(sessionId: string, rawMessage: string) {
    const session = this.getSession(sessionId);
    const message = rawMessage?.trim();

    if (!message) {
      throw new BadRequestException('Mensagem nao pode ser vazia.');
    }

    if (message.length > 600) {
      throw new BadRequestException('Mensagem muito longa. Limite de 600 caracteres.');
    }

    const now = new Date().toISOString();
    const userMessage: SupportMessage = {
      id: randomUUID(),
      sender: 'user',
      text: message,
      createdAt: now,
    };

    session.messages.push(userMessage);
    session.lastActivityAt = now;

    const autoReplyText = this.buildAutoReply(message);
    const autoReply: SupportMessage = {
      id: randomUUID(),
      sender: 'agent',
      text: autoReplyText,
      createdAt: new Date(Date.now() + 1200).toISOString(),
    };

    session.messages.push(autoReply);
    session.lastActivityAt = autoReply.createdAt;

    return {
      sessionId: session.id,
      ...this.getLiveStatus(),
      messages: session.messages,
      sent: [userMessage, autoReply],
      lastActivityAt: session.lastActivityAt,
    };
  }

  private getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException('Sessao de suporte nao encontrada.');
    }
    return session;
  }

  private buildAutoReply(message: string) {
    const normalized = message.toLowerCase();

    if (normalized.includes('pix') || normalized.includes('pag')) {
      return 'Recebido! Posso ajudar com pagamento PIX, status do pedido e prazo de confirmacao. Se quiser, envie o numero do pedido.';
    }

    if (
      normalized.includes('nao entrou') ||
      normalized.includes('nao caiu') ||
      normalized.includes('pedido')
    ) {
      return 'Vamos verificar agora. Envie seu e-mail de cadastro e, se tiver, o identificador do pedido para acelerar o atendimento.';
    }

    if (
      normalized.includes('sorteio') ||
      normalized.includes('ganhador') ||
      normalized.includes('resultado')
    ) {
      return 'Consigo te orientar no fluxo de sorteio e transparencia. Assim que a rifa fecha, o sistema publica o resultado e o historico.';
    }

    return 'Mensagem recebida. Nosso time esta ao vivo e vai te apoiar no que precisar sobre rifas, pagamentos e pedidos.';
  }
}
