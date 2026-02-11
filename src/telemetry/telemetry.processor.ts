import { Processor, Process, OnQueueActive, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { IngestionService } from './ingestion.service';
import { MeterTelemetryDto, VehicleTelemetryDto } from './dto/telemetry.dto';

/**
 * Processes telemetry jobs from BullMQ queues with intelligent batching
 * Batches are processed when queue reaches threshold via periodic checks
 */
@Processor('telemetry-meter')
export class MeterTelemetryProcessor {
  private readonly logger = new Logger(MeterTelemetryProcessor.name);
  private processingTimer: NodeJS.Timeout;
  private readonly BATCH_SIZE = 1000;
  private readonly CHECK_INTERVAL_MS = 500; // Check every 500ms for fast batching
  private readonly FALLBACK_INTERVAL_MS = 10000; // Flush all after 10s
  private lastProcessTime = Date.now();
  private isProcessing = false;

  constructor(
    @InjectQueue('telemetry-meter') private meterQueue: Queue,
    private readonly ingestionService: IngestionService,
  ) {
    this.startPeriodicProcessing();
    this.logger.log('Meter telemetry processor initialized');
  }

  /**
   * Periodic check: Process batch when we have enough jobs OR after timeout
   */
  private startPeriodicProcessing(): void {
    this.processingTimer = setInterval(async () => {
      if (this.isProcessing) {
        return; // Skip if already processing
      }

      const waitingCount = await this.meterQueue.getWaitingCount();
      const timeSinceLastProcess = Date.now() - this.lastProcessTime;

      // Trigger batch if:
      // 1. We have >= BATCH_SIZE jobs (immediate)
      // 2. We have any jobs AND 10 seconds passed (fallback)
      if (waitingCount >= this.BATCH_SIZE) {
        this.logger.log(`📦 Batch threshold reached: ${waitingCount} jobs, processing immediately`);
        await this.processBatch();
      } else if (waitingCount > 0 && timeSinceLastProcess >= this.FALLBACK_INTERVAL_MS) {
        this.logger.log(`⏰ Fallback timer triggered: ${waitingCount} jobs waiting, processing now`);
        await this.processBatch();
      }
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Process up to BATCH_SIZE waiting jobs in a single database transaction
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get up to BATCH_SIZE waiting jobs
      const jobs = await this.meterQueue.getJobs(['waiting', 'active'], 0, this.BATCH_SIZE - 1);
      
      if (jobs.length === 0) {
        this.isProcessing = false;
        return;
      }

      const startTime = Date.now();
      const batch = jobs.map(j => j.data);

      // Batch insert to database
      await this.ingestionService.ingestMeterDataBatch(batch);

      // Remove completed jobs
      await Promise.all(jobs.map(j => j.remove()));

      const duration = Date.now() - startTime;
      this.lastProcessTime = Date.now();
      this.logger.log(`✅ Processed ${batch.length} meter records in ${duration}ms`);
    } catch (error) {
      this.logger.error(`❌ Failed to process meter batch: ${error.message}`, error.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  async onModuleDestroy() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }
    // Process any remaining jobs
    await this.processBatch();
    this.logger.log('Meter telemetry processor shutdown complete');
  }
}

@Processor('telemetry-vehicle')
export class VehicleTelemetryProcessor {
  private readonly logger = new Logger(VehicleTelemetryProcessor.name);
  private processingTimer: NodeJS.Timeout;
  private readonly BATCH_SIZE = 1000;
  private readonly CHECK_INTERVAL_MS = 500;
  private readonly FALLBACK_INTERVAL_MS = 10000;
  private lastProcessTime = Date.now();
  private isProcessing = false;

  constructor(
    @InjectQueue('telemetry-vehicle') private vehicleQueue: Queue,
    private readonly ingestionService: IngestionService,
  ) {
    this.startPeriodicProcessing();
    this.logger.log('Vehicle telemetry processor initialized');
  }

  /**
   * Periodic check: Process batch when we have enough jobs OR after timeout
   */
  private startPeriodicProcessing(): void {
    this.processingTimer = setInterval(async () => {
      if (this.isProcessing) {
        return;
      }

      const waitingCount = await this.vehicleQueue.getWaitingCount();
      const timeSinceLastProcess = Date.now() - this.lastProcessTime;

      if (waitingCount >= this.BATCH_SIZE) {
        this.logger.log(`📦 Batch threshold reached: ${waitingCount} jobs, processing immediately`);
        await this.processBatch();
      } else if (waitingCount > 0 && timeSinceLastProcess >= this.FALLBACK_INTERVAL_MS) {
        this.logger.log(`⏰ Fallback timer triggered: ${waitingCount} jobs waiting, processing now`);
        await this.processBatch();
      }
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Process up to BATCH_SIZE waiting jobs in a single database transaction
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const jobs = await this.vehicleQueue.getJobs(['waiting', 'active'], 0, this.BATCH_SIZE - 1);
      
      if (jobs.length === 0) {
        this.isProcessing = false;
        return;
      }

      const startTime = Date.now();
      const batch = jobs.map(j => j.data);

      await this.ingestionService.ingestVehicleDataBatch(batch);
      await Promise.all(jobs.map(j => j.remove()));

      const duration = Date.now() - startTime;
      this.lastProcessTime = Date.now();
      this.logger.log(`✅ Processed ${batch.length} vehicle records in ${duration}ms`);
    } catch (error) {
      this.logger.error(`❌ Failed to process vehicle batch: ${error.message}`, error.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  async onModuleDestroy() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }
    await this.processBatch();
    this.logger.log('Vehicle telemetry processor shutdown complete');
  }
}
