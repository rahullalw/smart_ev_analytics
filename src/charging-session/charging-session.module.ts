import { Module } from '@nestjs/common';
import { ChargingSessionService } from './charging-session.service';

@Module({
  providers: [ChargingSessionService],
  exports: [ChargingSessionService],
})
export class ChargingSessionModule {}
