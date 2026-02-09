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

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DATABASE_POOL) private pool: Pool) {}

  /**
   * Get vehicle performance metrics for last 24 hours
   * Optimized query using:
   * - Partition pruning (only scans 1-2 partitions)
   * - Index on (vehicle_id, recorded_at DESC)
   * - Separate aggregations to avoid Cartesian product
   * @param vehicleId UUID of the vehicle
   * @returns Performance metrics
   */
  async getVehiclePerformance(vehicleId: string): Promise<PerformanceMetrics> {
    const query = `
      WITH time_range AS (
        SELECT 
          NOW() - INTERVAL '24 hours' AS start_time,
          NOW() AS end_time
      ),
      vehicle_data AS (
        SELECT 
          SUM(kwh_delivered_dc) AS total_dc,
          AVG(battery_temp) AS avg_temp,
          COUNT(*) AS dc_count
        FROM vehicle_telemetry
        WHERE vehicle_id = $1
          AND recorded_at >= (SELECT start_time FROM time_range)
          AND recorded_at <= (SELECT end_time FROM time_range)
      ),
      -- Correlation: Find associated meter(s) for this vehicle
      -- Uses vehicle_meter_mapping table for flexible N:M correlation
      meter_data AS (
        SELECT 
          COALESCE(SUM(m.kwh_consumed_ac), 0) AS total_ac
        FROM meter_telemetry m
        INNER JOIN vehicle_meter_mapping vm ON m.meter_id = vm.meter_id
        WHERE vm.vehicle_id = $1
          AND vm.is_active = TRUE
          AND m.recorded_at >= (SELECT start_time FROM time_range)
          AND m.recorded_at <= (SELECT end_time FROM time_range)
      )
      SELECT 
        v.total_dc,
        v.avg_temp,
        v.dc_count,
        COALESCE(m.total_ac, 0) AS total_ac
      FROM vehicle_data v
      CROSS JOIN meter_data m
    `;

    const result = await this.pool.query(query, [vehicleId]);

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
}
