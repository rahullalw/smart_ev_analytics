import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { MeterTelemetryDto, VehicleTelemetryDto } from './dto/telemetry.dto';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(@Inject(DATABASE_POOL) private pool: Pool) {}

  /**
   * Batch ingest meter telemetry data
   * Optimized for high-throughput scenarios (e.g., load testing, batch imports)
   * Uses UNNEST to perform bulk UPSERT and INSERT in single queries
   * @param dataArray Array of meter telemetry payloads
   */
  async ingestMeterDataBatch(dataArray: MeterTelemetryDto[]): Promise<void> {
    if (dataArray.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Extract arrays for bulk operations
      const meterIds = dataArray.map(d => d.meterId);
      const kwhValues = dataArray.map(d => d.kwhConsumedAc);
      const voltages = dataArray.map(d => d.voltage);
      const timestamps = dataArray.map(d => d.timestamp);

      // Hot store: Batch UPSERT using UNNEST
      await client.query(
        `INSERT INTO meter_state (meter_id, kwh_consumed_ac, voltage, last_updated)
         SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::timestamptz[])
         ON CONFLICT (meter_id) DO UPDATE SET
           kwh_consumed_ac = EXCLUDED.kwh_consumed_ac,
           voltage = EXCLUDED.voltage,
           last_updated = EXCLUDED.last_updated`,
        [meterIds, kwhValues, voltages, timestamps],
      );

      // Cold store: Batch INSERT using UNNEST
      await client.query(
        `INSERT INTO meter_telemetry (meter_id, kwh_consumed_ac, voltage, recorded_at)
         SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::timestamptz[])`,
        [meterIds, kwhValues, voltages, timestamps],
      );

      await client.query('COMMIT');
      this.logger.log(`Batch ingested ${dataArray.length} meter records`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to batch ingest meter data: ${error.message}`, error.stack);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Batch ingest vehicle telemetry data
   * Optimized for high-throughput scenarios (e.g., load testing, batch imports)
   * Uses UNNEST to perform bulk UPSERT and INSERT in single queries
   * @param dataArray Array of vehicle telemetry payloads
   */
  async ingestVehicleDataBatch(dataArray: VehicleTelemetryDto[]): Promise<void> {
    if (dataArray.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Extract arrays for bulk operations
      const vehicleIds = dataArray.map(d => d.vehicleId);
      const socValues = dataArray.map(d => d.soc);
      const kwhValues = dataArray.map(d => d.kwhDeliveredDc);
      const tempValues = dataArray.map(d => d.batteryTemp);
      const timestamps = dataArray.map(d => d.timestamp);

      // Hot store: Batch UPSERT using UNNEST
      await client.query(
        `INSERT INTO vehicle_state (vehicle_id, soc, kwh_delivered_dc, battery_temp, last_updated)
         SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::timestamptz[])
         ON CONFLICT (vehicle_id) DO UPDATE SET
           soc = EXCLUDED.soc,
           kwh_delivered_dc = EXCLUDED.kwh_delivered_dc,
           battery_temp = EXCLUDED.battery_temp,
           last_updated = EXCLUDED.last_updated`,
        [vehicleIds, socValues, kwhValues, tempValues, timestamps],
      );

      // Cold store: Batch INSERT using UNNEST
      await client.query(
        `INSERT INTO vehicle_telemetry (vehicle_id, soc, kwh_delivered_dc, battery_temp, recorded_at)
         SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::timestamptz[])`,
        [vehicleIds, socValues, kwhValues, tempValues, timestamps],
      );

      await client.query('COMMIT');
      this.logger.log(`Batch ingested ${dataArray.length} vehicle records`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to batch ingest vehicle data: ${error.message}`, error.stack);
      throw error;
    } finally {
      client.release();
    }
  }
}

