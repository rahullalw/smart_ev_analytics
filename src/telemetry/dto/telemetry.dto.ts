import { IsUUID, IsNumber, IsISO8601, Min, Max } from 'class-validator';

export class MeterTelemetryDto {
  @IsUUID()
  meterId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  kwhConsumedAc: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(500) // Sanity check: 500V max for AC voltage
  voltage: number;

  @IsISO8601()
  timestamp: string;
}

export class VehicleTelemetryDto {
  @IsUUID()
  vehicleId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  soc: number; // State of Charge (%)

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  kwhDeliveredDc: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-40)
  @Max(80) // Battery temperature range (-40°C to 80°C)
  batteryTemp: number;

  @IsISO8601()
  timestamp: string;
}
