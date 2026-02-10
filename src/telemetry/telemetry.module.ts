import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';

@Module({
  controllers: [],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class TelemetryModule {}
