import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { TelemetryBufferService } from './telemetry-buffer.service';

@Module({
  controllers: [],
  providers: [IngestionService, TelemetryBufferService],
  exports: [IngestionService, TelemetryBufferService],
})
export class TelemetryModule {}
