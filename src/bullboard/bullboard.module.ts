import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'telemetry-meter',
    }),
    BullModule.registerQueue({
      name: 'telemetry-vehicle',
    }),
    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'telemetry-meter',
      adapter: BullAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'telemetry-vehicle',
      adapter: BullAdapter,
    }),
  ],
})
export class BullBoardConfigModule {}
