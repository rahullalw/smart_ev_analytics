#!/usr/bin/env ts-node
/**
 * MQTT Telemetry Publisher - Proof of Concept
 * 
 * Simulates IoT devices publishing telemetry data to MQTT broker
 * Usage: npm run test:mqtt [deviceCount] [durationSeconds]
 */

import * as mqtt from 'mqtt';
import { randomUUID } from 'crypto';

interface Config {
  brokerUrl: string;
  deviceCount: number;
  durationSeconds: number;
  publishIntervalMs: number;
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

class MqttTelemetryPublisher {
  private client: mqtt.MqttClient;
  private deviceIds: { meterId: string; vehicleId: string }[];
  private messageCount = 0;
  private startTime: number;

  constructor(private config: Config) {
    this.client = mqtt.connect(config.brokerUrl, {
      clientId: `mqtt-publisher-${Math.random().toString(16).substring(2, 8)}`,
      reconnectPeriod: 5000,
    });

    // Generate device IDs
    this.deviceIds = Array.from({ length: config.deviceCount }, () => ({
      meterId: randomUUID(),
      vehicleId: randomUUID(),
    }));

    this.startTime = Date.now();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.on('connect', () => {
        console.log(`✅ Connected to MQTT broker: ${this.config.brokerUrl}`);
        console.log(`📡 Simulating ${this.config.deviceCount} devices for ${this.config.durationSeconds}s`);
        console.log(`---`);

        this.publishLoop();

        // Stop after duration
        setTimeout(() => {
          this.stop();
          resolve();
        }, this.config.durationSeconds * 1000);
      });

      this.client.on('error', (error) => {
        console.error('❌ MQTT connection error:', error);
        reject(error);
      });
    });
  }

  private publishLoop(): void {
    const interval = setInterval(() => {
      // Publish data for all devices
      this.deviceIds.forEach(({ meterId, vehicleId }) => {
        this.publishMeterData(meterId);
        this.publishVehicleData(vehicleId);
      });

      // Show progress
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const throughput = (this.messageCount / parseFloat(elapsed)).toFixed(0);
      process.stdout.write(`\r📊 Messages sent: ${this.messageCount} | Throughput: ${throughput} msg/s`);
    }, this.config.publishIntervalMs);

    // Clear interval after duration
    setTimeout(() => clearInterval(interval), this.config.durationSeconds * 1000);
  }

  private publishMeterData(meterId: string): void {
    const payload: MeterTelemetry = {
      meterId,
      kwhConsumedAc: parseFloat((Math.random() * 100).toFixed(3)),
      voltage: parseFloat((220 + Math.random() * 20).toFixed(2)),
      timestamp: new Date().toISOString(),
    };

    this.client.publish(
      `telemetry/meter/${meterId}`,
      JSON.stringify(payload),
      { qos: 1 }, // QoS 1: At least once delivery
      (error) => {
        if (error) {
          console.error(`\n❌ Failed to publish meter data:`, error);
        } else {
          this.messageCount++;
        }
      },
    );
  }

  private publishVehicleData(vehicleId: string): void {
    const payload: VehicleTelemetry = {
      vehicleId,
      soc: parseFloat((Math.random() * 100).toFixed(2)),
      kwhDeliveredDc: parseFloat((Math.random() * 80).toFixed(3)),
      batteryTemp: parseFloat((20 + Math.random() * 15).toFixed(2)),
      timestamp: new Date().toISOString(),
    };

    this.client.publish(
      `telemetry/vehicle/${vehicleId}`,
      JSON.stringify(payload),
      { qos: 1 },
      (error) => {
        if (error) {
          console.error(`\n❌ Failed to publish vehicle data:`, error);
        } else {
          this.messageCount++;
        }
      },
    );
  }

  private stop(): void {
    console.log('\n\n---');
    console.log(`✅ Test completed`);
    console.log(`📈 Total messages: ${this.messageCount}`);
    console.log(`⏱️  Duration: ${this.config.durationSeconds}s`);
    console.log(`🚀 Avg throughput: ${(this.messageCount / this.config.durationSeconds).toFixed(0)} msg/s`);
    this.client.end();
  }
}

// Main execution
async function main() {
  const deviceCount = parseInt(process.argv[2] || '10');
  const durationSeconds = parseInt(process.argv[3] || '30');

  const config: Config = {
    brokerUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
    deviceCount,
    durationSeconds,
    publishIntervalMs: 1000, // Publish every second
  };

  console.log(`🚀 MQTT Telemetry Publisher - Proof of Concept`);
  console.log(`📍 Broker: ${config.brokerUrl}`);
  console.log(`🔧 Devices: ${config.deviceCount}`);
  console.log(`⏱️  Duration: ${config.durationSeconds}s`);
  console.log(`---`);

  const publisher = new MqttTelemetryPublisher(config);
  await publisher.start();
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
