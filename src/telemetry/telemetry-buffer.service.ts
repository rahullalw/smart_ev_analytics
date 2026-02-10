import { Injectable, Logger } from '@nestjs/common';
import { IngestionService } from '../telemetry/ingestion.service';
import { MeterTelemetryDto, VehicleTelemetryDto } from '../telemetry/dto/telemetry.dto';

@Injectable()
export class TelemetryBufferService {
  private readonly logger = new Logger(TelemetryBufferService.name);
  
  private meterBuffer: MeterTelemetryDto[] = [];
  private vehicleBuffer: VehicleTelemetryDto[] = [];
  
  private readonly FLUSH_INTERVAL_MS = 10000; // 10 seconds
  private readonly MAX_BUFFER_SIZE = 1000;
  
  private flushTimer: NodeJS.Timeout;
  private isShuttingDown = false;
  private isFlushing = false; // Prevents concurrent flushes

  constructor(private readonly ingestionService: IngestionService) {
    this.startFlushTimer();
    this.logger.log(`Telemetry buffer initialized (flush every ${this.FLUSH_INTERVAL_MS}ms, max size: ${this.MAX_BUFFER_SIZE})`);
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      await this.flush();
    }, this.FLUSH_INTERVAL_MS);
  }

  async addMeterData(data: MeterTelemetryDto): Promise<void> {
    if (this.isShuttingDown) {
      await this.ingestionService.ingestMeterDataBatch([data]);
      return;
    }

    this.meterBuffer.push(data);

    if (this.meterBuffer.length >= this.MAX_BUFFER_SIZE && !this.isFlushing) {
      this.logger.log(`Meter buffer reached ${this.meterBuffer.length} records, triggering flush`);
      await this.flush();
    }
  }

  async addVehicleData(data: VehicleTelemetryDto): Promise<void> {
    if (this.isShuttingDown) {
      await this.ingestionService.ingestVehicleDataBatch([data]);
      return;
    }

    this.vehicleBuffer.push(data);

    if (this.vehicleBuffer.length >= this.MAX_BUFFER_SIZE && !this.isFlushing) {
      this.logger.log(`Vehicle buffer reached ${this.vehicleBuffer.length} records, triggering flush`);
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    // Prevent concurrent flushes
    if (this.isFlushing) {
      return;
    }

    // Quick check before acquiring lock
    if (this.meterBuffer.length === 0 && this.vehicleBuffer.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      // Swap buffers atomically
      const meterBatch = this.meterBuffer;
      const vehicleBatch = this.vehicleBuffer;
      this.meterBuffer = [];
      this.vehicleBuffer = [];

      const totalCount = meterBatch.length + vehicleBatch.length;
      this.logger.log(`Flushing ${meterBatch.length} meter + ${vehicleBatch.length} vehicle = ${totalCount} records`);

      // Flush in parallel
      const promises: Promise<void>[] = [];

      if (meterBatch.length > 0) {
        promises.push(this.ingestionService.ingestMeterDataBatch(meterBatch));
      }

      if (vehicleBatch.length > 0) {
        promises.push(this.ingestionService.ingestVehicleDataBatch(vehicleBatch));
      }

      await Promise.all(promises);
      
      this.logger.log(`Flush complete: ${totalCount} records written`);
    } catch (error) {
      this.logger.error(`Flush failed: ${error.message}`, error.stack);
    } finally {
      this.isFlushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down telemetry buffer service...');
    this.isShuttingDown = true;
    
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    await this.flush();
    this.logger.log('Telemetry buffer shutdown complete');
  }

  getBufferStats() {
    return {
      meterBufferSize: this.meterBuffer.length,
      vehicleBufferSize: this.vehicleBuffer.length,
      totalBuffered: this.meterBuffer.length + this.vehicleBuffer.length,
      flushIntervalMs: this.FLUSH_INTERVAL_MS,
      maxBufferSize: this.MAX_BUFFER_SIZE,
      isFlushing: this.isFlushing,
    };
  }
}
