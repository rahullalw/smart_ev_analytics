import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { IngestionService } from './ingestion.service';
import { MeterTelemetryProcessor, VehicleTelemetryProcessor } from './telemetry.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'telemetry-meter',
    }),
    BullModule.registerQueue({
      name: 'telemetry-vehicle',
    }),
  ],
  controllers: [],
  providers: [IngestionService, MeterTelemetryProcessor, VehicleTelemetryProcessor],
  exports: [
    IngestionService, 
    BullModule.registerQueue({ name: 'telemetry-meter' }),
    BullModule.registerQueue({ name: 'telemetry-vehicle' }),
  ],
})
export class TelemetryModule {}
