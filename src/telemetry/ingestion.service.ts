import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { MeterTelemetryDto, VehicleTelemetryDto } from './dto/telemetry.dto';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(@Inject(DATABASE_POOL) private pool: Pool) {}


  async ingestMeterDataBatch(dataArray: MeterTelemetryDto[]): Promise<void> {
    if (dataArray.length === 0) return;

    // DEDUPLICATION Telemetry Data
    const deduped = new Map<string, MeterTelemetryDto>();
    for (const record of dataArray) {
      deduped.set(record.meterId, record);
    }
    const uniqueData = Array.from(deduped.values());
    if (uniqueData.length < dataArray.length) {
      this.logger.debug(`Deduped ${dataArray.length} -> ${uniqueData.length} meter records`);
    }

    // Use original data directly (no deduplication)
    // const uniqueData = dataArray;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Extract arrays for bulk operations
      const meterIds = uniqueData.map(d => d.meterId);
      const kwhValues = uniqueData.map(d => d.kwhConsumedAc);
      const voltages = uniqueData.map(d => d.voltage);
      const timestamps = uniqueData.map(d => d.timestamp);

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

      // Cold store: Batch INSERT using UNNEST (ALL records - complete history)  
      const allMeterIds = dataArray.map(d => d.meterId);
      const allKwhValues = dataArray.map(d => d.kwhConsumedAc);
      const allVoltages = dataArray.map(d => d.voltage);
      const allTimestamps = dataArray.map(d => d.timestamp);

      await client.query(
        `INSERT INTO meter_telemetry (meter_id, kwh_consumed_ac, voltage, recorded_at)
         SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::timestamptz[])`,
        [allMeterIds, allKwhValues, allVoltages, allTimestamps],
      );

      await client.query('COMMIT');
      this.logger.log(`Batch ingested ${uniqueData.length} unique + ${dataArray.length} historical meter records`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to batch ingest meter data: ${error.message}`, error.stack);
      throw error;
    } finally {
      client.release();
    }
  }

  async ingestVehicleDataBatch(dataArray: VehicleTelemetryDto[]): Promise<void> {
    if (dataArray.length === 0) return;

    // DEDUPLICATION Telemetry Data
    const deduped = new Map<string, VehicleTelemetryDto>();
    for (const record of dataArray) {
      deduped.set(record.vehicleId, record);
    }
    const uniqueData = Array.from(deduped.values());
    if (uniqueData.length < dataArray.length) {
      this.logger.debug(`Deduped ${dataArray.length} -> ${uniqueData.length} vehicle records`);
    }

    // Use original data directly (no deduplication)
    // const uniqueData = dataArray;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Extract arrays for bulk operations
      const vehicleIds = uniqueData.map(d => d.vehicleId);
      const socValues = uniqueData.map(d => d.soc);
      const kwhValues = uniqueData.map(d => d.kwhDeliveredDc);
      const tempValues = uniqueData.map(d => d.batteryTemp);
      const timestamps = uniqueData.map(d => d.timestamp);

      // Hot store: Batch UPSERT using UNNEST (deduplicated - latest state only)
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

      // Cold store: Batch INSERT using UNNEST (ALL records - complete history)
      const allVehicleIds = dataArray.map(d => d.vehicleId);
      const allSocValues = dataArray.map(d => d.soc);
      const allKwhValues = dataArray.map(d => d.kwhDeliveredDc);
      const allTempValues = dataArray.map(d => d.batteryTemp);
      const allTimestamps = dataArray.map(d => d.timestamp);

      await client.query(
        `INSERT INTO vehicle_telemetry (vehicle_id, soc, kwh_delivered_dc, battery_temp, recorded_at)
         SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::timestamptz[])`,
        [allVehicleIds, allSocValues, allKwhValues, allTempValues, allTimestamps],
      );

      await client.query('COMMIT');
      this.logger.log(`Batch ingested ${uniqueData.length} unique + ${dataArray.length} historical vehicle records`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to batch ingest vehicle data: ${error.message}`, error.stack);
      throw error;
    } finally {
      client.release();
    }
  }
}

