import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { TelemetryBufferService } from '../telemetry/telemetry-buffer.service';
import { MeterTelemetryDto, VehicleTelemetryDto } from '../telemetry/dto/telemetry.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@Controller()
export class MqttController {
  private readonly logger = new Logger(MqttController.name);

  constructor(private readonly bufferService: TelemetryBufferService) {}

  /**
   * Handle meter telemetry messages from MQTT
   * Topic: telemetry/meter/{meterId}
   * Optimization #2: Uses buffering for 90% reduction in DB transactions
   */
  @MessagePattern('telemetry/meter/+')
  async handleMeterTelemetry(
    @Payload() data: any,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    this.logger.debug(`Received MQTT message on topic: ${topic}`);

    try {
      // Validate DTO (payload is already parsed by NestJS)
      const dto = plainToInstance(MeterTelemetryDto, data);
      const errors = await validate(dto);

      if (errors.length > 0) {
        this.logger.error(`Invalid meter telemetry data: ${JSON.stringify(errors)}`);
        return;
      }

      // Add to buffer instead of immediate DB write
      await this.bufferService.addMeterData(dto);
      this.logger.debug(`MQTT: Meter ${dto.meterId} telemetry buffered`);
    } catch (error) {
      this.logger.error(`Failed to process meter MQTT message: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle vehicle telemetry messages from MQTT
   * Topic: telemetry/vehicle/{vehicleId}
   * Optimization #2: Uses buffering for 90% reduction in DB transactions
   */
  @MessagePattern('telemetry/vehicle/+')
  async handleVehicleTelemetry(
    @Payload() data: any,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    this.logger.debug(`Received MQTT message on topic: ${topic}`);

    try {
      // Validate DTO (payload is already parsed by NestJS)
      const dto = plainToInstance(VehicleTelemetryDto, data);
      const errors = await validate(dto);

      if (errors.length > 0) {
        this.logger.error(`Invalid vehicle telemetry data: ${JSON.stringify(errors)}`);
        return;
      }

      // Add to buffer instead of immediate DB write
      await this.bufferService.addVehicleData(dto);
      this.logger.debug(`MQTT: Vehicle ${dto.vehicleId} telemetry buffered`);
    } catch (error) {
      this.logger.error(`Failed to process vehicle MQTT message: ${error.message}`, error.stack);
    }
  }
}
