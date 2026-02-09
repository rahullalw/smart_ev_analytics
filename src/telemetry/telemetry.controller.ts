import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { MeterTelemetryDto, VehicleTelemetryDto } from './dto/telemetry.dto';

@Controller('v1/telemetry')
export class TelemetryController {
  constructor(private ingestionService: IngestionService) {}

  @Post('meter')
  @HttpCode(204)
  async ingestMeter(@Body() data: MeterTelemetryDto): Promise<void> {
    await this.ingestionService.ingestMeterData(data);
  }

  @Post('vehicle')
  @HttpCode(204)
  async ingestVehicle(@Body() data: VehicleTelemetryDto): Promise<void> {
    await this.ingestionService.ingestVehicleData(data);
  }
}
