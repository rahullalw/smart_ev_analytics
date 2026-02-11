#!/usr/bin/env ts-node
/**
 * Seed Database with Sample Vehicles and Meters
 * By Default Creates 100 vehicles and 100 meters with active mappings
 */

import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

interface SeedConfig {
  vehicleCount: number;
  meterCount: number;
  databaseUrl: string;
}

class DatabaseSeeder {
  private pool: Pool;
  private vehicleIds: string[] = [];
  private meterIds: string[] = [];

  constructor(private config: SeedConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
    });
  }

  async seed(): Promise<{ vehicleIds: string[]; meterIds: string[] }> {
    console.log('🌱 Seeding database...');
    console.log(`   Vehicles: ${this.config.vehicleCount}`);
    console.log(`   Meters: ${this.config.meterCount}`);
    console.log('---');

    try {
      await this.pool.query('BEGIN');

      // Clear existing data
      console.log('🧹 Clearing existing data...');
      await this.pool.query('TRUNCATE TABLE vehicle_meter_mapping, meter_state, vehicle_state, meter_telemetry, vehicle_telemetry CASCADE');
      console.log('   ✓ Database cleared');

      // Generate IDs
      this.vehicleIds = Array.from({ length: this.config.vehicleCount }, () => randomUUID());
      this.meterIds = Array.from({ length: this.config.meterCount }, () => randomUUID());

      // Seed vehicles
      await this.seedVehicles();

      // Seed meters
      await this.seedMeters();

      await this.pool.query('COMMIT');

      console.log('\n✅ Database seeded successfully!');
      console.log(`   ${this.vehicleIds.length} vehicles created`);
      console.log(`   ${this.meterIds.length} meters created`);

      return {
        vehicleIds: this.vehicleIds,
        meterIds: this.meterIds,
      };
    } catch (error) {
      await this.pool.query('ROLLBACK');
      console.error('❌ Seeding failed:', error);
      throw error;
    }
  }

  private async seedVehicles(): Promise<void> {
    console.log('📦 Inserting vehicles...');

    // Batch insert vehicles into vehicle_state
    const values = this.vehicleIds.map((id) => ({
      id,
      soc: parseFloat((20 + Math.random() * 60).toFixed(2)), // Initial SOC: 20-80%
      kwhDeliveredDc: 0, // Starting charge
      batteryTemp: parseFloat((20 + Math.random() * 5).toFixed(2)), // 20-25°C
      lastUpdated: new Date(),
    }));

    const vehicleIdArray = values.map((v) => v.id);
    const socArray = values.map((v) => v.soc);
    const kwhArray = values.map((v) => v.kwhDeliveredDc);
    const tempArray = values.map((v) => v.batteryTemp);
    const timestampArray = values.map((v) => v.lastUpdated);

    await this.pool.query(
      `INSERT INTO vehicle_state (vehicle_id, soc, kwh_delivered_dc, battery_temp, last_updated)
       SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::timestamptz[])`,
      [vehicleIdArray, socArray, kwhArray, tempArray, timestampArray],
    );

    console.log(`   ✓ ${this.vehicleIds.length} vehicles inserted`);
  }

  private async seedMeters(): Promise<void> {
    console.log('📦 Inserting meters...');

    // Batch insert meters into meter_state
    const values = this.meterIds.map((id) => ({
      id,
      kwhConsumedAc: parseFloat((Math.random() * 10).toFixed(3)), // Initial consumption
      voltage: parseFloat((220 + Math.random() * 10).toFixed(2)), // 220-230V
      lastUpdated: new Date(),
    }));

    const meterIdArray = values.map((m) => m.id);
    const kwhArray = values.map((m) => m.kwhConsumedAc);
    const voltageArray = values.map((m) => m.voltage);
    const timestampArray = values.map((m) => m.lastUpdated);

    await this.pool.query(
      `INSERT INTO meter_state (meter_id, kwh_consumed_ac, voltage, last_updated)
       SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::timestamptz[])`,
      [meterIdArray, kwhArray, voltageArray, timestampArray],
    );

    console.log(`   ✓ ${this.meterIds.length} meters inserted`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getDeviceIds(): Promise<{ vehicleIds: string[]; meterIds: string[] }> {
    return {
      vehicleIds: this.vehicleIds,
      meterIds: this.meterIds,
    };
  }
}

// Main execution
async function main() {
  const vehicleCount = parseInt(process.argv[2] || '100');
  const meterCount = parseInt(process.argv[3] || '100');

  const config: SeedConfig = {
    vehicleCount,
    meterCount,
    databaseUrl: process.env.DATABASE_URL,
  };

  console.log('🚀 Database Seeder');
  console.log(`📊 Target: ${config.vehicleCount} vehicles, ${config.meterCount} meters`);
  console.log(`🔗 Database: ${config.databaseUrl.replace(/:[^:]*@/, ':***@')}`);
  console.log('---\n');

  const seeder = new DatabaseSeeder(config);

  try {
    const { vehicleIds, meterIds } = await seeder.seed();

    // Save IDs to file for use by telemetry publisher
    const fs = require('fs');
    const deviceIds = {
      vehicleIds,
      meterIds,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync('test/device-ids.json', JSON.stringify(deviceIds, null, 2));
    console.log('\n💾 Device IDs saved to: test/device-ids.json');
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await seeder.close();
  }

  console.log('\n✅ Seeding complete! Ready to send telemetry data.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
