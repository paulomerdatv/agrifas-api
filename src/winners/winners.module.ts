import { Module } from '@nestjs/common';
import { WinnersController } from './winners.controller';

@Module({
  controllers: [WinnersController],
})
export class WinnersModule {}
