import { Injectable, Inject, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

export interface ActiveSession {
  vehicleId: string;
  meterId: string;
  mappedAt: Date;
}

@Injectable()
export class ChargingSessionService {
  private readonly logger = new Logger(ChargingSessionService.name);

  constructor(@Inject(DATABASE_POOL) private pool: Pool) {}

  async startSession(vehicleId: string, meterId: string): Promise<void> {
    // Check if vehicle already has active session
    const existing = await this.pool.query(
      'SELECT 1 FROM vehicle_meter_mapping WHERE vehicle_id = $1 AND is_active = TRUE',
      [vehicleId]
    );

    if (existing.rows.length > 0) {
      throw new ConflictException(`Vehicle ${vehicleId} already has an active charging session`);
    }

    await this.pool.query(
      `INSERT INTO vehicle_meter_mapping (vehicle_id, meter_id, mapped_at, is_active)
       VALUES ($1, $2, NOW(), TRUE)`,
      [vehicleId, meterId]
    );

    this.logger.log(`Started charging session: vehicle ${vehicleId} → meter ${meterId}`);
  }

  async endSession(vehicleId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE vehicle_meter_mapping 
       SET is_active = FALSE, unmapped_at = NOW()
       WHERE vehicle_id = $1 AND is_active = TRUE
       RETURNING meter_id`,
      [vehicleId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`No active charging session found for vehicle ${vehicleId}`);
    }

    this.logger.log(`Ended charging session: vehicle ${vehicleId} (meter: ${result.rows[0].meter_id})`);
  }

  async getActiveSession(vehicleId: string): Promise<ActiveSession | null> {
    const result = await this.pool.query(
      `SELECT vehicle_id, meter_id, mapped_at 
       FROM vehicle_meter_mapping 
       WHERE vehicle_id = $1 AND is_active = TRUE`,
      [vehicleId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      vehicleId: result.rows[0].vehicle_id,
      meterId: result.rows[0].meter_id,
      mappedAt: result.rows[0].mapped_at,
    };
  }

  async startBatchSessions(vehicleIds: string[], meterIds: string[]): Promise<number> {
    const count = Math.min(vehicleIds.length, meterIds.length);
    
    await this.pool.query(
      `INSERT INTO vehicle_meter_mapping (vehicle_id, meter_id, mapped_at, is_active)
       SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::timestamptz[], $4::boolean[])`,
      [
        vehicleIds.slice(0, count),
        meterIds.slice(0, count),
        Array(count).fill(new Date()),
        Array(count).fill(true)
      ]
    );

    this.logger.log(`Started ${count} charging sessions in batch`);
    return count;
  }

  async endBatchSessions(vehicleIds: string[]): Promise<number> {
    const result = await this.pool.query(
      `UPDATE vehicle_meter_mapping 
       SET is_active = FALSE, unmapped_at = NOW()
       WHERE vehicle_id = ANY($1::uuid[]) AND is_active = TRUE`,
      [vehicleIds]
    );

    this.logger.log(`Ended ${result.rowCount} charging sessions in batch`);
    return result.rowCount || 0;
  }
}
