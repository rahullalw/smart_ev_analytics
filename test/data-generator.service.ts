import * as http from 'http';

export class DataGenerator {
  private meterIds: string[] = [];
  private vehicleIds: string[] = [];

  constructor(
    private deviceCount: number = 100,
    private baseUrl: string = 'http://localhost:3000',
  ) {
    // Generate UUIDs for devices (simplified UUID format for testing)
    for (let i = 0; i < deviceCount; i++) {
      const paddedId = i.toString().padStart(12, '0');
      this.meterIds.push(`00000000-0000-0000-0000-${paddedId}`);
      this.vehicleIds.push(`11111111-1111-1111-1111-${paddedId}`);
    }
  }

  /**
   * Generate telemetry load for specified duration
   * @param durationSeconds How long to run the load test
   */
  async generateLoad(durationSeconds: number): Promise<void> {
    const startTime = Date.now();
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;

    console.log(`Starting load test with ${this.deviceCount} devices...`);

    while ((Date.now() - startTime) / 1000 < durationSeconds) {
      const batchStart = Date.now();
      const promises = [];

      // Send telemetry for all devices
      for (let i = 0; i < this.deviceCount; i++) {
        promises.push(
          this.sendMeterData(this.meterIds[i]).then(() => successfulRequests++).catch(() => failedRequests++)
        );
        promises.push(
          this.sendVehicleData(this.vehicleIds[i]).then(() => successfulRequests++).catch(() => failedRequests++)
        );
      }

      await Promise.all(promises);
      totalRequests += promises.length;

      const elapsed = (Date.now() - batchStart) / 1000;
      console.log(`Batch complete: ${promises.length} requests in ${elapsed.toFixed(2)}s`);

      // Wait 60 seconds before next batch (simulate 1-minute interval)
      const waitTime = Math.max(0, 60000 - (Date.now() - batchStart));
      if (waitTime > 0 && (Date.now() - startTime) / 1000 < durationSeconds) {
        console.log(`Waiting ${(waitTime / 1000).toFixed(1)}s until next batch...`);
        await this.sleep(waitTime);
      }
    }

    console.log(`\nLoad test complete:`);
    console.log(`  Total requests: ${totalRequests}`);
    console.log(`  Successful: ${successfulRequests}`);
    console.log(`  Failed: ${failedRequests}`);
    console.log(`  Success rate: ${((successfulRequests / totalRequests) * 100).toFixed(2)}%`);
  }

  /**
   * Send a single batch immediately (for quick testing)
   */
  async sendSingleBatch(): Promise<void> {
    console.log(`Sending single batch of ${this.deviceCount * 2} telemetry records...`);
    const promises = [];

    for (let i = 0; i < this.deviceCount; i++) {
      promises.push(this.sendMeterData(this.meterIds[i]));
      promises.push(this.sendVehicleData(this.vehicleIds[i]));
    }

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Batch complete: ${successful}/${results.length} successful`);
  }

  /**
   * Create vehicle-meter mappings for correlation
   */
  async createMappings(): Promise<void> {
    console.log('Creating vehicle-meter mappings...');
    
    // For simplicity, map each vehicle to its corresponding meter (1:1)
    // In production, this would be done via an admin API
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://admin:dev_password@localhost:5432/smart_ev',
    });

    try {
      for (let i = 0; i < this.deviceCount; i++) {
        await pool.query(
          `INSERT INTO vehicle_meter_mapping (vehicle_id, meter_id, is_active)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (vehicle_id, meter_id) DO NOTHING`,
          [this.vehicleIds[i], this.meterIds[i]],
        );
      }
      console.log(`Created ${this.deviceCount} vehicle-meter mappings`);
    } finally {
      await pool.end();
    }
  }

  private async sendMeterData(meterId: string): Promise<void> {
    const data = {
      meterId,
      kwhConsumedAc: Math.random() * 100,
      voltage: 220 + Math.random() * 20,
      timestamp: new Date().toISOString(),
    };

    return this.postData('/v1/telemetry/meter', data);
  }

  private async sendVehicleData(vehicleId: string): Promise<void> {
    const data = {
      vehicleId,
      soc: Math.random() * 100,
      kwhDeliveredDc: Math.random() * 80,
      batteryTemp: 20 + Math.random() * 30,
      timestamp: new Date().toISOString(),
    };

    return this.postData('/v1/telemetry/vehicle', data);
  }

  private postData(path: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      const options = {
        hostname: 'localhost',
        port: 3000,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = http.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          if (res.statusCode === 204 || res.statusCode === 200 || res.statusCode === 201) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
          }
        });
      });

      req.on(' error', reject);
      req.write(postData);
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
