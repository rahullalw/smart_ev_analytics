import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

export interface PerformanceMetrics {
  vehicleId: string;
  totalAcConsumption: number;
  totalDcDelivery: number;
  efficiencyRatio: number;
  avgBatteryTemp: number;
  dataPoints: number;
}

export interface VehicleState {
  vehicleId: string;
  soc: number;
  kwhDeliveredDc: number;
  batteryTemp: number;
  lastUpdated: string;
  meterKwhConsumedAc?: number;
  meterVoltage?: number;
  meterLastUpdated?: string;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DATABASE_POOL) private pool: Pool) {}

  async getVehiclePerformance(vehicleId: string): Promise<PerformanceMetrics> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

    const result = await this.pool.query(
      `WITH time_range AS (
         SELECT $2::timestamptz AS start_time, $3::timestamptz AS end_time
       ),
       vehicle_data AS (
         SELECT 
           (MAX(kwh_delivered_dc) - MIN(kwh_delivered_dc)) AS total_dc,
           AVG(battery_temp) AS avg_temp,
           COUNT(*) AS dc_count
         FROM vehicle_telemetry
         WHERE vehicle_id = $1 AND recorded_at >= $2 AND recorded_at <= $3
       ),
       meter_data AS (
         SELECT COALESCE(MAX(m.kwh_consumed_ac) - MIN(m.kwh_consumed_ac), 0) AS total_ac
         FROM meter_telemetry m
         INNER JOIN vehicle_meter_mapping vm ON m.meter_id = vm.meter_id
         WHERE vm.vehicle_id = $1
           -- Session was active during the time range
           AND vm.mapped_at <= $3
           AND (vm.unmapped_at IS NULL OR vm.unmapped_at >= $2)
           AND m.recorded_at >= $2 AND m.recorded_at <= $3
       )
       SELECT v.total_dc, v.avg_temp, v.dc_count, COALESCE(m.total_ac, 0) AS total_ac
       FROM vehicle_data v CROSS JOIN meter_data m`,
      [vehicleId, startTime, endTime]
    );

    if (!result.rows.length || result.rows[0].dc_count === 0) {
      throw new NotFoundException(
        `No data found for vehicle ${vehicleId} in last 24 hours`,
      );
    }

    const row = result.rows[0];
    const totalAc = parseFloat(row.total_ac) || 0;
    const totalDc = parseFloat(row.total_dc) || 0;

    this.logger.debug(
      `Vehicle ${vehicleId} performance: ${totalDc} kWh DC, ${totalAc} kWh AC`,
    );

    return {
      vehicleId,
      totalAcConsumption: totalAc,
      totalDcDelivery: totalDc,
      efficiencyRatio: totalAc > 0 ? totalDc / totalAc : 0,
      avgBatteryTemp: parseFloat(row.avg_temp),
      dataPoints: parseInt(row.dc_count),
    };
  }

  async getAllVehicleStates(limit: number = 100): Promise<VehicleState[]> {
    const query = `
      SELECT 
        vs.vehicle_id,
        vs.soc,
        vs.kwh_delivered_dc,
        vs.battery_temp,
        vs.last_updated,
        ms.kwh_consumed_ac,
        ms.voltage,
        ms.last_updated as meter_last_updated
      FROM vehicle_state vs
      LEFT JOIN vehicle_meter_mapping vmm 
        ON vs.vehicle_id = vmm.vehicle_id AND vmm.is_active = TRUE
      LEFT JOIN meter_state ms 
        ON vmm.meter_id = ms.meter_id
      ORDER BY vs.last_updated DESC
      LIMIT $1
    `;

    const result = await this.pool.query(query, [limit]);

    return result.rows.map(row => ({
      vehicleId: row.vehicle_id,
      soc: parseFloat(row.soc),
      kwhDeliveredDc: parseFloat(row.kwh_delivered_dc),
      batteryTemp: parseFloat(row.battery_temp),
      lastUpdated: row.last_updated,
      meterKwhConsumedAc: row.kwh_consumed_ac ? parseFloat(row.kwh_consumed_ac) : undefined,
      meterVoltage: row.voltage ? parseFloat(row.voltage) : undefined,
      meterLastUpdated: row.meter_last_updated || undefined,
    }));
  }
}
