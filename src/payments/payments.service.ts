import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createInfinitePayCheckout(jwtUser: { userId: string }, dto: CreateCheckoutDto) {
    const { raffleId, selectedTickets } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: jwtUser.userId },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    if (!selectedTickets.length) {
      throw new BadRequestException('Nenhuma cota foi selecionada.');
    }

    const uniqueTickets = [...new Set(selectedTickets)];

    if (uniqueTickets.length !== selectedTickets.length) {
      throw new BadRequestException('Há cotas duplicadas na seleção.');
    }

    // Ajuste esta validação se sua modelagem de rifa tiver outro campo de limite total
    if (raffle.totalTickets) {
      const invalidTicket = uniqueTickets.find(
        (ticket) => ticket < 1 || ticket > raffle.totalTickets,
      );

      if (invalidTicket) {
        throw new BadRequestException(`A cota ${invalidTicket} é inválida para esta rifa.`);
      }
    }

    // Verifica se alguma dessas cotas já foi paga em outros pedidos
    const paidOrders = await this.prisma.order.findMany({
      where: {
        raffleId,
        status: 'PAID',
      },
      select: {
        selectedTickets: true,
      },
    });

    const alreadySoldTickets = new Set(
      paidOrders.flatMap((order) => order.selectedTickets),
    );

    const conflictedTickets = uniqueTickets.filter((ticket) =>
      alreadySoldTickets.has(ticket),
    );

    if (conflictedTickets.length > 0) {
      throw new BadRequestException(
        `As seguintes cotas já foram vendidas: ${conflictedTickets.join(', ')}`,
      );
    }

    // Se existir campo específico por rifa, use-o. Ex.: raffle.pricePerTicket
    if (!raffle.pricePerTicket || Number(raffle.pricePerTicket) <= 0) {
      throw new BadRequestException('Preço da cota da rifa inválido.');
    }

    const totalAmount = Number(raffle.pricePerTicket) * uniqueTickets.length;

    const handle = process.env.INFINITEPAY_HANDLE;
    const apiUrl = process.env.INFINITEPAY_API_URL;
    const checkoutPath = process.env.INFINITEPAY_CHECKOUT_PATH;

    if (!handle) {
      throw new InternalServerErrorException('INFINITEPAY_HANDLE não configurado.');
    }

    if (!apiUrl || !checkoutPath) {
      throw new InternalServerErrorException(
        'Variáveis da InfinitePay não configuradas corretamente.',
      );
    }

    const orderNsu = `AGRIFAS-${randomUUID()}`;

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        raffleId: raffle.id,
        selectedTickets: uniqueTickets,
        totalAmount,
        status: 'PENDING',
        provider: 'INFINITEPAY',
        orderNsu,
        paymentMethod: 'PIX',
      },
    });

    const payload: any = {
      handle,
      items: [
        {
          quantity: 1,
          price: Math.round(totalAmount * 100), // centavos
          description: `Cotas da rifa ${raffle.title} (${uniqueTickets.join(', ')})`,
        },
      ],
    };

    try {
      const response = await fetch(`${apiUrl}${checkoutPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new BadRequestException({
          message: 'Falha ao criar checkout na InfinitePay.',
          statusCode: response.status,
          providerResponse: responseData,
        });
      }

      const checkoutUrl = responseData?.checkout_url;

      if (!checkoutUrl) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new InternalServerErrorException(
          'checkout_url não devolvida pela InfinitePay.',
        );
      }

      return {
        orderId: order.id,
        orderNsu: order.orderNsu,
        checkoutUrl,
      };
    } catch (error) {
      // Evita sobrescrever erro já tratado
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }

      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'FAILED' },
      });

      throw new InternalServerErrorException({
        message: 'Erro inesperado ao criar checkout.',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  }

  async checkOrderStatus(orderNsu: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNsu },
      include: {
        raffle: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado.');
    }

    return {
      orderId: order.id,
      orderNsu: order.orderNsu,
      status: order.status,
      totalAmount: order.totalAmount,
      selectedTickets: order.selectedTickets,
      raffle: order.raffle
        ? {
            id: order.raffle.id,
            title: order.raffle.title,
          }
        : null,
      receiptUrl: order.receiptUrl,
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}