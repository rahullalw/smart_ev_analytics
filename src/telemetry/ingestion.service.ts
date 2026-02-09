import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { MeterTelemetryDto, VehicleTelemetryDto } from './dto/telemetry.dto';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(@Inject(DATABASE_POOL) private pool: Pool) {}

  /**
   * Ingest meter telemetry data
   * Dual-write: Hot store (UPSERT) + Cold store (INSERT) in one transaction
   * @param data Meter telemetry payload
   */
  async ingestMeterData(data: MeterTelemetryDto): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Hot store: UPSERT latest state
      // ON CONFLICT ensures atomic updates under high concurrency
      await client.query(
        `INSERT INTO meter_state (meter_id, kwh_consumed_ac, voltage, last_updated)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (meter_id) 
         DO UPDATE SET 
           kwh_consumed_ac = EXCLUDED.kwh_consumed_ac,
           voltage = EXCLUDED.voltage,
           last_updated = EXCLUDED.last_updated`,
        [data.meterId, data.kwhConsumedAc, data.voltage, data.timestamp],
      );

      // Cold store: Append to partitioned history
      await client.query(
        `INSERT INTO meter_telemetry (meter_id, kwh_consumed_ac, voltage, recorded_at)
         VALUES ($1, $2, $3, $4)`,
        [data.meterId, data.kwhConsumedAc, data.voltage, data.timestamp],
      );

      await client.query('COMMIT');
      this.logger.debug(`Meter ${data.meterId} telemetry ingested`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to ingest meter data: ${error.message}`, error.stack);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Ingest vehicle telemetry data
   * Dual-write: Hot store (UPSERT) + Cold store (INSERT) in one transaction
   * @param data Vehicle telemetry payload
   */
  async ingestVehicleData(data: VehicleTelemetryDto): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Hot store: UPSERT latest state
      await client.query(
        `INSERT INTO vehicle_state (vehicle_id, soc, kwh_delivered_dc, battery_temp, last_updated)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (vehicle_id)
         DO UPDATE SET
           soc = EXCLUDED.soc,
           kwh_delivered_dc = EXCLUDED.kwh_delivered_dc,
           battery_temp = EXCLUDED.battery_temp,
           last_updated = EXCLUDED.last_updated`,
        [
          data.vehicleId,
          data.soc,
          data.kwhDeliveredDc,
          data.batteryTemp,
          data.timestamp,
        ],
      );

      // Cold store: Append to partitioned history
      await client.query(
        `INSERT INTO vehicle_telemetry (vehicle_id, soc, kwh_delivered_dc, battery_temp, recorded_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          data.vehicleId,
          data.soc,
          data.kwhDeliveredDc,
          data.batteryTemp,
          data.timestamp,
        ],
      );

      await client.query('COMMIT');
      this.logger.debug(`Vehicle ${data.vehicleId} telemetry ingested`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to ingest vehicle data: ${error.message}`, error.stack);
      throw error;
    } finally {
      client.release();
    }
  }
}
