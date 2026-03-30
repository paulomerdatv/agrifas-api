import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RafflesModule } from './raffles/raffles.module';
import { AdminModule } from './admin/admin.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { SupportModule } from './support/support.module';
import { WinnersModule } from './winners/winners.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    RafflesModule,
    AdminModule,
    OrdersModule,
    PaymentsModule, // WebhooksModule removido, tudo concentrado aqui
    SupportModule,
    WinnersModule,
  ],
})
export class AppModule {}
