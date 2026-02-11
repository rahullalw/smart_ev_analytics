#!/usr/bin/env ts-node
/**
 * Production Service Stress Test
 * 
 * Tests the real IngestionService under high load:
 * - Loads all device IDs in 1 query
 * - Sends telemetry data directly to IngestionService (bypassing MQTT)
 * - Simulates realistic charging patterns with staggered data
 * - Generates comprehensive performance metrics
 * - Evaluates if system meets production requirements
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import * as Bull from 'bull';
import * as dotenv from 'dotenv';

dotenv.config();
import { IngestionService } from '../src/telemetry/ingestion.service';
import { ChargingSessionService } from '../src/charging-session/charging-session.service';
import { MeterTelemetryDto, VehicleTelemetryDto } from '../src/telemetry/dto/telemetry.dto';

interface DeviceIdsFile {
  vehicleIds: string[];
  meterIds: string[];
  timestamp: string;
}

interface PerformanceMetrics {
  totalMessages: number;
  totalDuration: number;
  avgThroughput: number;
  peakThroughput: number;
  batchesProcessed: number;
  avgBatchSize: number;
  errorCount: number;
  successRate: number;
}

interface TestResult {
  success: boolean;
  metrics: PerformanceMetrics;
  requirements: {
    meetsTargetThroughput: boolean;
    meetsErrorRate: boolean;
    meetsLatency: boolean;
  };
  summary: string;
}

class ProductionServiceTester {
  private vehicleStates: Map<string, { soc: number; kwhDelivered: number }> = new Map();
  private meterStates: Map<string, { kwhConsumed: number; lastAcIncrement?: number }> = new Map();
  private totalMessagesSent = 0;
  private totalErrors = 0;
  private startTime: number;
  private intervalTimers: NodeJS.Timeout[] = [];
  private throughputSamples: number[] = [];
  private batchSizes: number[] = [];

  constructor(
    private ingestionService: IngestionService,
    private vehicleIds: string[],
    private meterIds: string[],
    private durationMinutes: number,
  ) {
    console.log(`📋 Loaded ${vehicleIds.length} vehicles and ${meterIds.length} meters`);

    // Initialize states
    vehicleIds.forEach((id) => {
      this.vehicleStates.set(id, {
        soc: 20 + Math.random() * 60,
        kwhDelivered: 0,
      });
    });

    meterIds.forEach((id) => {
      this.meterStates.set(id, {
        kwhConsumed: Math.random() * 5,
        lastAcIncrement: 0.3, // Default value
      });
    });

    this.startTime = Date.now();
  }

  async start(): Promise<PerformanceMetrics> {
    const totalDevices = this.vehicleIds.length + this.meterIds.length;
    
    console.log(`✅ Starting production service stress test`);
    console.log(`⏱️  Duration: ${this.durationMinutes} minutes`);
    console.log(`📊 Devices: ${totalDevices} total`);
    console.log(`🎯 Each device sends 1 message per 60 seconds (staggered)`);
    console.log(`📈 Expected steady throughput: ~${Math.round(totalDevices / 60)} msg/s`);
    console.log('---\n');

    this.startStaggeredLoad();

    // Throughput sampler every 5 seconds
    const samplerInterval = setInterval(() => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      const throughput = this.totalMessagesSent / elapsed;
      this.throughputSamples.push(throughput);
      console.log(`📊 Total: ${this.totalMessagesSent.toLocaleString()} | Throughput: ${throughput.toFixed(0)} msg/s | Errors: ${this.totalErrors} | Elapsed: ${elapsed.toFixed(0)}s`);
    }, 5000);

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, this.durationMinutes * 60 * 1000));

    // Stop test
    clearInterval(samplerInterval);
    this.intervalTimers.forEach(timer => clearInterval(timer));

    const elapsed = (Date.now() - this.startTime) / 1000;
    const expectedMessages = Math.floor((elapsed / 60)) * totalDevices;

    const metrics: PerformanceMetrics = {
      totalMessages: this.totalMessagesSent,
      totalDuration: elapsed,
      avgThroughput: this.totalMessagesSent / elapsed,
      peakThroughput: Math.max(...this.throughputSamples),
      batchesProcessed: this.batchSizes.length,
      avgBatchSize: this.batchSizes.length > 0 ? this.batchSizes.reduce((a, b) => a + b, 0) / this.batchSizes.length : 0,
      errorCount: this.totalErrors,
      successRate: (this.totalMessagesSent / (this.totalMessagesSent + this.totalErrors)) * 100,
    };

    console.log('\n\n---');
    console.log(`✅ Load test completed`);
    console.log(`📈 Total messages: ${metrics.totalMessages.toLocaleString()}`);
    console.log(`📊 Expected messages: ${expectedMessages.toLocaleString()}`);
    console.log(`⏱️  Duration: ${(metrics.totalDuration / 60).toFixed(2)} minutes`);
    console.log(`🚀 Avg throughput: ${metrics.avgThroughput.toFixed(1)} msg/s`);
    console.log(`⚡ Peak throughput: ${metrics.peakThroughput.toFixed(1)} msg/s`);
    console.log(`📦 Batches processed: ${metrics.batchesProcessed}`);
    console.log(`📊 Avg batch size: ${metrics.avgBatchSize.toFixed(0)}`);
    console.log(`❌ Errors: ${metrics.errorCount}`);
    console.log(`✅ Success rate: ${metrics.successRate.toFixed(2)}%`);

    return metrics;
  }

  private startStaggeredLoad(): void {
    const totalDevices = this.vehicleIds.length + this.meterIds.length;
    const staggerIntervalMs = (60 * 1000) / totalDevices; // Spread devices evenly over 60 seconds

    console.log(`🔄 Staggering ${totalDevices} devices over 60 seconds`);
    console.log(`   Interval between device starts: ${staggerIntervalMs.toFixed(2)}ms\n`);

    let deviceIndex = 0;

    // Batch accumulators
    const meterBatch: MeterTelemetryDto[] = [];
    const vehicleBatch: VehicleTelemetryDto[] = [];
    const BATCH_SIZE = 1000; // Process in batches of 1000

    // Start meters with staggered delays
    this.meterIds.forEach((meterId) => {
      const initialDelay = deviceIndex * staggerIntervalMs;
      deviceIndex++;

      setTimeout(() => {
        // Send first message
        this.generateMeterData(meterId, meterBatch);

        // Then send every 60 seconds
        const timer = setInterval(() => {
          this.generateMeterData(meterId, meterBatch);
        }, 60000);

        this.intervalTimers.push(timer);
      }, initialDelay);
    });

    // Start vehicles with staggered delays
    this.vehicleIds.forEach((vehicleId) => {
      const initialDelay = deviceIndex * staggerIntervalMs;
      deviceIndex++;

      setTimeout(() => {
        // Send first message
        this.generateVehicleData(vehicleId, vehicleBatch);

        // Then send every 60 seconds
        const timer = setInterval(() => {
          this.generateVehicleData(vehicleId, vehicleBatch);
        }, 60000);

        this.intervalTimers.push(timer);
      }, initialDelay);
    });

    // Batch processor - sends accumulated data to service every 100ms
    setInterval(async () => {
      const meterDataToSend = [...meterBatch];
      const vehicleDataToSend = [...vehicleBatch];
      
      meterBatch.length = 0;
      vehicleBatch.length = 0;

      if (meterDataToSend.length > 0) {
        this.batchSizes.push(meterDataToSend.length);
        try {
          await this.ingestionService.ingestMeterDataBatch(meterDataToSend);
          this.totalMessagesSent += meterDataToSend.length;
        } catch (error) {
          this.totalErrors += meterDataToSend.length;
          console.error(`❌ Meter batch failed: ${error.message}`);
        }
      }

      if (vehicleDataToSend.length > 0) {
        this.batchSizes.push(vehicleDataToSend.length);
        try {
          await this.ingestionService.ingestVehicleDataBatch(vehicleDataToSend);
          this.totalMessagesSent += vehicleDataToSend.length;
        } catch (error) {
          this.totalErrors += vehicleDataToSend.length;
          console.error(`❌ Vehicle batch failed: ${error.message}`);
        }
      }
    }, 100);
  }

  private generateMeterData(meterId: string, batch: MeterTelemetryDto[]): void {
    const state = this.meterStates.get(meterId)!;
    
    // Simulate AC charging: each reading session consumes 0.1-0.5 kWh
    const acIncrement = parseFloat(((Math.random() * 0.4) + 0.1).toFixed(3));
    state.kwhConsumed += acIncrement;
    
    // Store AC consumed for correlated DC calculation
    state.lastAcIncrement = acIncrement;

    const payload: MeterTelemetryDto = {
      meterId,
      kwhConsumedAc: parseFloat(state.kwhConsumed.toFixed(3)),
      voltage: parseFloat((220 + Math.random() * 20).toFixed(2)),
      timestamp: new Date().toISOString(),
    };

    batch.push(payload);
  }

  private generateVehicleData(vehicleId: string, batch: VehicleTelemetryDto[]): void {
    const state = this.vehicleStates.get(vehicleId)!;
    
    // Get corresponding meter's last AC increment
    const meterIndex = this.vehicleIds.indexOf(vehicleId);
    const meterId = this.meterIds[meterIndex];
    const meterState = this.meterStates.get(meterId)!;
    const acIncrement = meterState.lastAcIncrement || 0.3;
    
    // Simulate realistic 85-90% AC→DC conversion efficiency
    const efficiency = 0.85 + (Math.random() * 0.05); // 85-90%
    const dcIncrement = parseFloat((acIncrement * efficiency).toFixed(3));
    
    // Simulate charging: increase SOC and delivered kWh
    if (state.soc < 100) {
      state.soc = Math.min(100, state.soc + (Math.random() * 2));
      state.kwhDelivered += dcIncrement;
    }

    const payload: VehicleTelemetryDto = {
      vehicleId,
      soc: parseFloat(state.soc.toFixed(2)),
      kwhDeliveredDc: parseFloat(state.kwhDelivered.toFixed(3)),
      batteryTemp: parseFloat((20 + Math.random() * 10).toFixed(2)),
      timestamp: new Date().toISOString(),
    };

    batch.push(payload);
  }
}

async function loadDeviceIds(): Promise<{ vehicleIds: string[]; meterIds: string[] }> {
  console.log('📥 Loading device IDs from seed file...');
  
  const deviceIdsPath = path.join(__dirname, 'device-ids.json');
  
  if (!fs.existsSync(deviceIdsPath)) {
    throw new Error('Device IDs file not found! Please run: npm run seed-db 5000 5000');
  }

  const deviceIdsFile = fs.readFileSync(deviceIdsPath, 'utf-8');
  const deviceIds: DeviceIdsFile = JSON.parse(deviceIdsFile);

  console.log(`✅ Loaded ${deviceIds.vehicleIds.length} vehicles and ${deviceIds.meterIds.length} meters from file\n`);

  return { vehicleIds: deviceIds.vehicleIds, meterIds: deviceIds.meterIds };
}

async function startChargingSessions(
  sessionService: ChargingSessionService,
  vehicleIds: string[], 
  meterIds: string[]
): Promise<number> {
  console.log('🔌 Starting charging sessions (vehicles plugging in)...');
  
  const count = await sessionService.startBatchSessions(vehicleIds, meterIds);
  console.log(`✅ Started ${count} charging sessions\n`);
  return count;
}

async function endChargingSessions(
  sessionService: ChargingSessionService,
  vehicleIds: string[]
): Promise<number> {
  console.log('\n🔌 Ending charging sessions (vehicles unplugging)...');
  
  const count = await sessionService.endBatchSessions(vehicleIds);
  console.log(`✅ Ended ${count} charging sessions\n`);
  return count;
}

async function resetSystem(pool: Pool) {
  console.log('🧹 Cleaning system state...');

  // 1. Reset Database
  try {
    await pool.query('TRUNCATE TABLE meter_telemetry, vehicle_telemetry, meter_state, vehicle_state, vehicle_meter_mapping RESTART IDENTITY CASCADE');
    console.log('✅ Database truncated');
  } catch (error) {
    console.error('⚠️  Database cleanup failed:', error.message);
  }

  // 2. Clear Queues
  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  };

  const queues = ['telemetry-meter', 'telemetry-vehicle'];
  for (const name of queues) {
    const q = new Bull(name, { redis: redisConfig });
    try {
      await q.obliterate({ force: true });
      console.log(`✅ Queue ${name} obliterated`);
    } catch (error) {
      console.error(`⚠️  Queue ${name} cleanup failed:`, error.message);
    } finally {
      await q.close();
    }
  }
  console.log('---\n');
}

async function validateResults(pool: Pool, metrics: PerformanceMetrics): Promise<TestResult> {
  console.log('\n🔍 Validating results...');

  // Query database to verify data was stored
  const dbResult = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM meter_telemetry) as meter_count,
      (SELECT COUNT(*) FROM vehicle_telemetry) as vehicle_count,
      (SELECT COUNT(*) FROM meter_state) as meter_state_count,
      (SELECT COUNT(*) FROM vehicle_state) as vehicle_state_count
  `);

  const row = dbResult.rows[0];
  console.log(`📊 Database verification:`);
  console.log(`   Meter telemetry: ${parseInt(row.meter_count).toLocaleString()}`);
  console.log(`   Vehicle telemetry: ${parseInt(row.vehicle_count).toLocaleString()}`);
  console.log(`   Meter states: ${parseInt(row.meter_state_count).toLocaleString()}`);
  console.log(`   Vehicle states: ${parseInt(row.vehicle_state_count).toLocaleString()}\n`);

  // Define production requirements
  const REQUIRED_THROUGHPUT = 150; // msg/s (10,000 devices / 60 seconds)
  const MAX_ERROR_RATE = 0.1; // 0.1%
  const TARGET_SUCCESS_RATE = 99.9; // 99.9%

  const meetsTargetThroughput = metrics.avgThroughput >= REQUIRED_THROUGHPUT;
  const meetsErrorRate = (metrics.errorCount / metrics.totalMessages * 100) <= MAX_ERROR_RATE;
  const meetsLatency = metrics.successRate >= TARGET_SUCCESS_RATE;

  console.log('📋 Requirements Check:');
  console.log(`   ${meetsTargetThroughput ? '✅' : '❌'} Throughput: ${metrics.avgThroughput.toFixed(1)} msg/s (required: ${REQUIRED_THROUGHPUT} msg/s)`);
  console.log(`   ${meetsErrorRate ? '✅' : '❌'} Error rate: ${((metrics.errorCount / metrics.totalMessages) * 100).toFixed(3)}% (max: ${MAX_ERROR_RATE}%)`);
  console.log(`   ${meetsLatency ? '✅' : '❌'} Success rate: ${metrics.successRate.toFixed(2)}% (min: ${TARGET_SUCCESS_RATE}%)`);

  const allRequirementsMet = meetsTargetThroughput && meetsErrorRate && meetsLatency;

  let summary = '';
  if (allRequirementsMet) {
    summary = `🎉 SUCCESS! System meets all production requirements.\n` +
              `   The service can handle 10,000 devices sending data every 60s.\n` +
              `   Average throughput: ${metrics.avgThroughput.toFixed(1)} msg/s\n` +
              `   Success rate: ${metrics.successRate.toFixed(2)}%`;
  } else {
    summary = `⚠️  PERFORMANCE ISSUES DETECTED!\n`;
    if (!meetsTargetThroughput) {
      summary += `   - Throughput below target (${metrics.avgThroughput.toFixed(1)} < ${REQUIRED_THROUGHPUT} msg/s)\n`;
    }
    if (!meetsErrorRate) {
      summary += `   - Error rate too high (${((metrics.errorCount / metrics.totalMessages) * 100).toFixed(3)}% > ${MAX_ERROR_RATE}%)\n`;
    }
    if (!meetsLatency) {
      summary += `   - Success rate below target (${metrics.successRate.toFixed(2)}% < ${TARGET_SUCCESS_RATE}%)\n`;
    }
  }

  return {
    success: allRequirementsMet,
    metrics,
    requirements: {
      meetsTargetThroughput,
      meetsErrorRate,
      meetsLatency,
    },
    summary,
  };
}

// Main execution
async function main() {
  const durationMinutes = parseFloat(process.argv[2] || '5'); // Default: 5 minutes

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('🚀 Production Service Stress Test');
  console.log(`⏱️  Duration: ${durationMinutes} minutes`);
  console.log(`📊 Using real IngestionService (production code path)`);
  console.log('---\n');

  try {
    await resetSystem(pool);

    // Step 1: Load all device IDs in 1 query
    const { vehicleIds, meterIds } = await loadDeviceIds();

    if (vehicleIds.length === 0 || meterIds.length === 0) {
      console.error('❌ No devices found in database!');
      console.error('📝 Please run: npm run seed-db 5000 5000');
      process.exit(1);
    }

    // Step 2: Initialize services
    const ingestionService = new IngestionService(pool);
    const sessionService = new ChargingSessionService(pool);

    // Step 3: Start charging sessions (vehicles plug in)
    await startChargingSessions(sessionService, vehicleIds, meterIds);

    // Step 4: Run load test
    const tester = new ProductionServiceTester(
      ingestionService,
      vehicleIds,
      meterIds,
      durationMinutes,
    );

    const metrics = await tester.start();

    // Step 5: End charging sessions (vehicles unplug)
    await endChargingSessions(sessionService, vehicleIds);

    // Step 6: Validate and generate results
    const result = await validateResults(pool, metrics);

    console.log('\n' + '='.repeat(80));
    console.log('STRESS TEST RESULTS');
    console.log('='.repeat(80));
    console.log(result.summary);
    console.log('='.repeat(80) + '\n');

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
