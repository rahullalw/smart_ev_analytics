import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { TelemetryController } from './telemetry.controller';

@Module({
  controllers: [TelemetryController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class TelemetryModule {}
