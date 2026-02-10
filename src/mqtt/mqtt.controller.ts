import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { MeterTelemetryDto, VehicleTelemetryDto } from '../telemetry/dto/telemetry.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@Controller()
export class MqttController {
  private readonly logger = new Logger(MqttController.name);

  constructor(
    @InjectQueue('telemetry-meter') private meterQueue: Queue,
    @InjectQueue('telemetry-vehicle') private vehicleQueue: Queue,
  ) {}

  /**
   * Handle meter telemetry messages from MQTT
   * Topic: telemetry/meter/{meterId}
   * Jobs are queued and processed in batches by TelemetryProcessor
   */
  @MessagePattern('telemetry/meter/+')
  async handleMeterTelemetry(
    @Payload() data: any,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    this.logger.debug(`Received MQTT message on topic: ${topic}`);

    try {
      // Validate DTO
      const dto = plainToInstance(MeterTelemetryDto, data);
      const errors = await validate(dto);

      if (errors.length > 0) {
        this.logger.error(`Invalid meter telemetry data: ${JSON.stringify(errors)}`);
        return;
      }

      // Add to BullMQ queue (will be batched by processor)
      await this.meterQueue.add('ingest', dto);
      this.logger.debug(`MQTT: Meter ${dto.meterId} telemetry queued`);
    } catch (error) {
      this.logger.error(`Failed to queue meter MQTT message: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle vehicle telemetry messages from MQTT
   * Topic: telemetry/vehicle/{vehicleId}
   * Jobs are queued and processed in batches by TelemetryProcessor
   */
  @MessagePattern('telemetry/vehicle/+')
  async handleVehicleTelemetry(
    @Payload() data: any,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    this.logger.debug(`Received MQTT message on topic: ${topic}`);

    try {
      // Validate DTO
      const dto = plainToInstance(VehicleTelemetryDto, data);
      const errors = await validate(dto);

      if (errors.length > 0) {
        this.logger.error(`Invalid vehicle telemetry data: ${JSON.stringify(errors)}`);
        return;
      }

      // Add to BullMQ queue (will be batched by processor)
      await this.vehicleQueue.add('ingest', dto);
      this.logger.debug(`MQTT: Vehicle ${dto.vehicleId} telemetry queued`);
    } catch (error) {
      this.logger.error(`Failed to queue vehicle MQTT message: ${error.message}`, error.stack);
    }
  }
}
