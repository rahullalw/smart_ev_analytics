#!/usr/bin/env ts-node
/**
 * MQTT Telemetry Stream Publisher
 * Uses pre-seeded device IDs to send realistic telemetry data
 * Tests BullMQ batching behavior with 100 vehicles + 100 meters
 */

import * as mqtt from 'mqtt';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

interface DeviceIdsFile {
  vehicleIds: string[];
  meterIds: string[];
  timestamp: string;
}

interface Config {
  brokerUrl: string;
  publishIntervalMs: number;
  totalMessages: number;
}

interface MeterTelemetry {
  meterId: string;
  kwhConsumedAc: number;
  voltage: number;
  timestamp: string;
}

interface VehicleTelemetry {
  vehicleId: string;
  soc: number;
  kwhDeliveredDc: number;
  batteryTemp: number;
  timestamp: string;
}

class TelemetryStreamPublisher {
  private client: mqtt.MqttClient;
  private deviceIds: DeviceIdsFile;
  private messageCount = 0;
  private startTime: number;
  private vehicleStates: Map<string, { soc: number; kwhDelivered: number }> = new Map();
  private meterStates: Map<string, { kwhConsumed: number }> = new Map();

  constructor(
    private config: Config,
    deviceIdsPath: string,
  ) {
    // Load device IDs from file
    const deviceIdsFile = fs.readFileSync(deviceIdsPath, 'utf-8');
    this.deviceIds = JSON.parse(deviceIdsFile);

    console.log(`📋 Loaded ${this.deviceIds.vehicleIds.length} vehicles and ${this.deviceIds.meterIds.length} meters`);

    // Initialize states (simulate ongoing charging)
    this.deviceIds.vehicleIds.forEach((id) => {
      this.vehicleStates.set(id, {
        soc: 20 + Math.random() * 60, // Start between 20-80%
        kwhDelivered: 0,
      });
    });

    this.deviceIds.meterIds.forEach((id) => {
      this.meterStates.set(id, {
        kwhConsumed: Math.random() * 5, // Initial consumption
      });
    });

    this.client = mqtt.connect(config.brokerUrl, {
      clientId: `telemetry-stream-${Math.random().toString(16).substring(2, 8)}`,
      reconnectPeriod: 5000,
    });

    this.startTime = Date.now();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.on('connect', () => {
        console.log(`✅ Connected to MQTT broker: ${this.config.brokerUrl}`);
        console.log(`📡 Publishing ${this.config.totalMessages} messages total`);
        console.log(`⏱️  Interval: ${this.config.publishIntervalMs}ms`);
        console.log(`🎯 Target: Trigger batching at 1000 records`);
        console.log('---\n');

        this.publishLoop();

        const totalDuration = (this.config.totalMessages / 2) * this.config.publishIntervalMs;
        setTimeout(() => {
          this.stop();
          resolve();
        }, totalDuration + 2000); // Add buffer
      });

      this.client.on('error', (error) => {
        console.error('❌ MQTT connection error:', error);
        reject(error);
      });
    });
  }

  private publishLoop(): void {
    let messagesSent = 0;
    const messagesPerBatch = 2; // 1 meter + 1 vehicle per iteration

    const interval = setInterval(() => {
      if (messagesSent >= this.config.totalMessages) {
        clearInterval(interval);
        return;
      }

      // Randomly select a vehicle-meter pair
      const index = Math.floor(Math.random() * Math.min(this.deviceIds.vehicleIds.length, this.deviceIds.meterIds.length));
      const vehicleId = this.deviceIds.vehicleIds[index];
      const meterId = this.deviceIds.meterIds[index];

      this.publishMeterData(meterId);
      this.publishVehicleData(vehicleId);

      messagesSent += messagesPerBatch;

      // Show progress
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const throughput = (this.messageCount / parseFloat(elapsed)).toFixed(0);
      const remaining = this.config.totalMessages - this.messageCount;
      
      process.stdout.write(
        `\r📊 Sent: ${this.messageCount}/${this.config.totalMessages} | ` +
        `Throughput: ${throughput} msg/s | ` +
        `Remaining: ${remaining} | ` +
        `Batches expected: ${Math.ceil(this.messageCount / 1000)}`
      );
    }, this.config.publishIntervalMs);
  }

  private publishMeterData(meterId: string): void {
    const state = this.meterStates.get(meterId)!;
    
    // Simulate charging: increase consumption
    state.kwhConsumed += parseFloat((Math.random() * 0.5).toFixed(3));

    const payload: MeterTelemetry = {
      meterId,
      kwhConsumedAc: parseFloat(state.kwhConsumed.toFixed(3)),
      voltage: parseFloat((220 + Math.random() * 20).toFixed(2)),
      timestamp: new Date().toISOString(),
    };

    this.client.publish(
      `telemetry/meter/${meterId}`,
      JSON.stringify(payload),
      { qos: 1 },
      (error) => {
        if (!error) {
          this.messageCount++;
        }
      },
    );
  }

  private publishVehicleData(vehicleId: string): void {
    const state = this.vehicleStates.get(vehicleId)!;
    
    // Simulate charging: increase SOC and delivered kWh
    if (state.soc < 100) {
      state.soc = Math.min(100, state.soc + Math.random() * 2); // +0-2% per message
      state.kwhDelivered += parseFloat((Math.random() * 0.5).toFixed(3));
    }

    const payload: VehicleTelemetry = {
      vehicleId,
      soc: parseFloat(state.soc.toFixed(2)),
      kwhDeliveredDc: parseFloat(state.kwhDelivered.toFixed(3)),
      batteryTemp: parseFloat((20 + Math.random() * 15).toFixed(2)),
      timestamp: new Date().toISOString(),
    };

    this.client.publish(
      `telemetry/vehicle/${vehicleId}`,
      JSON.stringify(payload),
      { qos: 1 },
      (error) => {
        if (!error) {
          this.messageCount++;
        }
      },
    );
  }

  private stop(): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    console.log('\n\n---');
    console.log(`✅ Telemetry stream completed`);
    console.log(`📈 Total messages: ${this.messageCount}`);
    console.log(`⏱️  Duration: ${elapsed.toFixed(1)}s`);
    console.log(`🚀 Avg throughput: ${(this.messageCount / elapsed).toFixed(0)} msg/s`);
    console.log(`📦 Expected batches: ${Math.ceil(this.messageCount / 1000)}`);
    console.log('\n💡 Check application logs for batch processing confirmation');
    this.client.end();
  }
}

// Main execution
async function main() {
  const totalMessages = parseInt(process.argv[2] || '2000'); // Default: 2000 (should trigger 2 batches)
  const intervalMs = parseInt(process.argv[3] || '100'); // Default: 100ms (fast publishing)

  const deviceIdsPath = path.join(__dirname, 'device-ids.json');

  // Check if device IDs file exists
  if (!fs.existsSync(deviceIdsPath)) {
    console.error('❌ Device IDs file not found!');
    console.error('📝 Please run: npm run seed-db (or ts-node test/seed-database.ts)');
    process.exit(1);
  }

  const config: Config = {
    brokerUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
    publishIntervalMs: intervalMs,
    totalMessages,
  };

  console.log('🚀 MQTT Telemetry Stream Publisher');
  console.log(`📍 Broker: ${config.brokerUrl}`);
  console.log(`🎯 Total Messages: ${config.totalMessages}`);
  console.log(`⏱️  Interval: ${config.publishIntervalMs}ms`);
  console.log('---\n');

  const publisher = new TelemetryStreamPublisher(config, deviceIdsPath);
  await publisher.start();
  
  console.log('\n🔍 Next steps:');
  console.log('   1. Check Redis queue: docker exec -it smart_ev_redis redis-cli');
  console.log('      > LLEN bull:telemetry-meter:waiting');
  console.log('      > LLEN bull:telemetry-vehicle:waiting');
  console.log('   2. Verify database records: docker exec -it smart_ev_db psql -U admin -d smart_ev');
  console.log('      > SELECT COUNT(*) FROM meter_telemetry;');
  console.log('      > SELECT COUNT(*) FROM vehicle_telemetry;');
  
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
