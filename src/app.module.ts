import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from './database/database.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { MqttModule } from './mqtt/mqtt.module';
import { BullBoardConfigModule } from './bullboard/bullboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
      defaultJobOptions: {
        removeOnComplete: 1000, // Keep last 1000 completed jobs for monitoring
        removeOnFail: 5000,     // Keep last 5000 failed jobs for debugging
      },
    }),
    BullBoardConfigModule,
    DatabaseModule,
    TelemetryModule,
    AnalyticsModule,
    MqttModule,
  ],
})
export class AppModule {}
