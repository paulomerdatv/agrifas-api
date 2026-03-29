import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createInfinitePayCheckout(
    jwtUser: any,
    raffleOrDto: string | { raffleId: string; selectedTickets: number[] },
    selectedTicketsArg?: number[],
  ) {
    try {
      const raffleId =
        typeof raffleOrDto === 'string' ? raffleOrDto : raffleOrDto.raffleId;

      const selectedTickets =
        typeof raffleOrDto === 'string'
          ? selectedTicketsArg ?? []
          : raffleOrDto.selectedTickets;

      this.logger.log(
        `Iniciando geração de checkout para o usuário ${jwtUser.userId}, Rifa: ${raffleId}`,
      );

      const user = await this.prisma.user.findUnique({
        where: { id: jwtUser.userId },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado no banco de dados.');
      }

      const raffle = await this.prisma.raffle.findUnique({
        where: { id: raffleId },
      });

      if (!raffle) {
        throw new NotFoundException('Rifa não encontrada.');
      }

      if (!selectedTickets || selectedTickets.length === 0) {
        throw new BadRequestException('Nenhum número selecionado.');
      }

      const existingOrders = await this.prisma.order.findMany({
        where: {
          raffleId,
          status: {
            in: ['PAID', 'PENDING'],
          },
        },
      });

      const occupiedTickets = existingOrders.flatMap((o) => o.selectedTickets);
      const hasConflict = selectedTickets.some((t) => occupiedTickets.includes(t));

      if (hasConflict) {
        throw new BadRequestException(
          'Algumas cotas selecionadas já estão reservadas ou vendidas.',
        );
      }

      const totalAmount = selectedTickets.length * raffle.pricePerTicket;
      const orderNsu = `AG-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;

      const order = await this.prisma.order.create({
        data: {
          userId: user.id,
          raffleId,
          selectedTickets,
          totalAmount,
          status: 'PENDING',
          provider: 'INFINITEPAY',
          orderNsu,
        },
      });

      // LINK FIXO REAL GERADO NO PAINEL DA INFINITEPAY
      const checkoutUrl =
        process.env.INFINITEPAY_FIXED_CHECKOUT_URL ||
        'https://checkout.infinitepay.io/arthur-65929587-38f/1sx42XLkNv';

      this.logger.log(
        `[PaymentsService] Checkout FIXO da InfinitePay retornado: ${checkoutUrl}`,
      );

      return {
        orderId: order.id,
        orderNsu: order.orderNsu,
        checkoutUrl,
        checkout_url: checkoutUrl,
      };
    } catch (error: any) {
      this.logger.error(
        `Erro Fatal em createInfinitePayCheckout: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Erro interno inesperado ao processar o pagamento.',
      );
    }
  }

  async checkPaymentStatus(orderNsu: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNsu },
      select: {
        id: true,
        status: true,
        receiptUrl: true,
        totalAmount: true,
        orderNsu: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado.');
    }

    return order;
  }

  async checkOrderStatus(orderNsu: string) {
    return this.checkPaymentStatus(orderNsu);
  }
}