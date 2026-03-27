import { Module } from '@nestjs/common';
import { RafflesController } from './raffles.controller';

@Module({
  controllers: [RafflesController],
})
export class RafflesModule {}