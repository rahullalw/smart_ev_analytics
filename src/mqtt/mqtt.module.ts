import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MqttController } from './mqtt.controller';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'MQTT_SERVICE',
        transport: Transport.MQTT,
        options: {
          url: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
          reconnectPeriod: 5000,
          connectTimeout: 30000,
        },
      },
    ]),
    TelemetryModule,
  ],
  controllers: [MqttController],
})
export class MqttModule {}
