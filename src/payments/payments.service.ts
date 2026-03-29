import { 
  Injectable, 
  NotFoundException, 
  BadRequestException, 
  InternalServerErrorException, 
  Logger 
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createInfinitePayCheckout(jwtUser: any, raffleId: string, selectedTickets: number[]) {
    try {
      this.logger.log(`Iniciando geração de checkout para o usuário ${jwtUser.userId}, Rifa: ${raffleId}`);

      // 1. Busca o usuário real no banco para garantir consistência
      const user = await this.prisma.user.findUnique({ 
        where: { id: jwtUser.userId } 
      });
      
      if (!user) {
        throw new NotFoundException('Usuário não encontrado no banco de dados.');
      }

      // 2. Valida Rifa
      const raffle = await this.prisma.raffle.findUnique({ 
        where: { id: raffleId } 
      });
      
      if (!raffle) {
        throw new NotFoundException('Rifa não encontrada.');
      }
      
      if (!selectedTickets || selectedTickets.length === 0) {
        throw new BadRequestException('Nenhum número selecionado.');
      }

      // 3. Valida conflito de cotas (Verifica se já não foram pagas)
      const existingOrders = await this.prisma.order.findMany({
        where: { raffleId, status: 'PAID' }
      });
      const soldTickets = existingOrders.flatMap(o => o.selectedTickets);
      const hasConflict = selectedTickets.some(t => soldTickets.includes(t));
      
      if (hasConflict) {
        throw new BadRequestException('Algumas cotas selecionadas já foram vendidas.');
      }

      const totalAmount = selectedTickets.length * raffle.pricePerTicket;
      const orderNsu = `AG-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // 4. Cria o Pedido PENDING
      const order = await this.prisma.order.create({
        data: {
          userId: user.id,
          raffleId,
          selectedTickets,
          totalAmount,
          status: 'PENDING',
          provider: 'INFINITEPAY',
          orderNsu,
        }
      });

      // 5. Setup de Variáveis da InfinitePay
      const baseUrl = process.env.INFINITEPAY_API_URL || 'https://api.infinitepay.io';
      const checkoutPath = process.env.INFINITEPAY_CHECKOUT_PATH || '/v2/payment-links';
      const apiKey = process.env.INFINITEPAY_API_KEY;
      const frontendUrl = process.env.FRONTEND_URL;
      const backendUrl = process.env.BACKEND_URL;

      if (!apiKey || !frontendUrl || !backendUrl) {
        this.logger.error('Configurações de pagamento (env) ausentes no servidor.');
        throw new InternalServerErrorException('Configurações de pagamento ausentes no servidor.');
      }

      // 6. Montagem Dinâmica do Payload Seguro
      // Usamos um payload mais simplificado para evitar rejeição por campos de customer inválidos (CPF/Tel)
      const infinitePayPayload = {
        amount: Math.round(totalAmount * 100), // InfinitePay exige valor em centavos inteiros (ex: R$ 10,50 vira 1050)
        description: `Cotas: ${raffle.title.substring(0, 40)} (${selectedTickets.join(', ').substring(0, 50)})`,
        redirect_url: `${frontendUrl}/pagamento/retorno?orderNsu=${orderNsu}`,
        webhook_url: `${backendUrl}/webhooks/infinitepay`,
        metadata: {
          order_nsu: orderNsu,
          customer_email: user.email,
          customer_name: user.name
        }
      };

      this.logger.log(`Enviando Payload para InfinitePay: ${JSON.stringify(infinitePayPayload)}`);

      // 7. Chamada externa à InfinitePay
      const response = await fetch(`${baseUrl}${checkoutPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify(infinitePayPayload)
      });

      // Lendo a resposta em texto bruto primeiro para poder logar erros com precisão
      const responseText = await response.text();
            this.logger.log(`INFINITEPAY BASE URL: ${baseUrl}`);
            this.logger.log(`INFINITEPAY CHECKOUT PATH: ${checkoutPath}`);
            this.logger.log(`INFINITEPAY PAYLOAD: ${JSON.stringify(infinitePayPayload)}`);
            this.logger.log(`INFINITEPAY STATUS: ${response.status}`);
            this.logger.log(`INFINITEPAY RAW RESPONSE: ${responseText}`);
      
      if (!response.ok) {
        this.logger.error(`Erro retornado pela InfinitePay: ${responseText}`);
        // Falha externa: atualiza para FAILED para liberar a tentativa
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' }
        });
        throw new InternalServerErrorException(`Falha ao gerar cobrança: Detalhes no log do servidor.`);
      }

      // Faz o parse do JSON caso tenha dado sucesso
      let responseData: any = null;

try {
  responseData = JSON.parse(responseText);
} catch (error) {
  this.logger.error(`INFINITEPAY JSON PARSE ERROR: ${responseText}`);
  await this.prisma.order.update({
    where: { id: order.id },
    data: { status: 'FAILED' },
  });
  throw new InternalServerErrorException(
    'InfinitePay retornou resposta inválida. Verifique os logs.',
  );
}

      // O campo da URL depende da resposta oficial (checamos os mais comuns)
      const checkoutUrl = responseData.url || responseData.payment_url || responseData.checkout_url;

      if (!checkoutUrl) {
        this.logger.error(`InfinitePay respondeu com sucesso, mas sem URL: ${responseText}`);
        throw new InternalServerErrorException('URL de checkout não devolvida pela InfinitePay.');
      }

      // Sucesso: Retorna o contrato esperado
      return {
        orderId: order.id,
        orderNsu: order.orderNsu,
        checkoutUrl: checkoutUrl,
        checkout_url: checkoutUrl // Garante o contrato exigido pelo frontend
      };

    } catch (error: any) {
      this.logger.error(`Erro Fatal em createInfinitePayCheckout: ${error.message}`, error.stack);
      
      // Repassa erros de negócio corretamente sem envelopar em 500 genérico
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Erro interno inexperado ao processar o pagamento.');
    }
  }

  async checkPaymentStatus(orderNsu: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNsu },
      select: { id: true, status: true, receiptUrl: true, totalAmount: true }
    });
    
    if (!order) {
      throw new NotFoundException('Pedido não encontrado.');
    }
    
    return order;
  }
}