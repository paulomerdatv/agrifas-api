import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { DiscordLogsModule } from './discord-logs/discord-logs.module';
import { HomeConfigModule } from './home-config/home-config.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { RafflesModule } from './raffles/raffles.module';
import { SecurityModule } from './common/security/security.module';
import { SupportModule } from './support/support.module';
import { UsersModule } from './users/users.module';
import { WinnersModule } from './winners/winners.module';

@Module({
  imports: [
    PrismaModule,
    DiscordLogsModule,
    SecurityModule,
    AuthModule,
    HomeConfigModule,
    CampaignsModule,
    UsersModule,
    RafflesModule,
    AdminModule,
    OrdersModule,
    PaymentsModule,
    SupportModule,
    WinnersModule,
  ],
})
export class AppModule {}
