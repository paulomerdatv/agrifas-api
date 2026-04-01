import { Global, Module } from '@nestjs/common';
import { AdminDiscordLogsController } from './admin-discord-logs.controller';
import { DiscordLogsService } from './discord-logs.service';

@Global()
@Module({
  controllers: [AdminDiscordLogsController],
  providers: [DiscordLogsService],
  exports: [DiscordLogsService],
})
export class DiscordLogsModule {}
