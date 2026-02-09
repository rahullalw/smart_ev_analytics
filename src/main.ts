import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Enable global validation for all DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error on unknown properties
      transform: true, // Auto-transform payloads to DTO instances
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Smart EV Analytics API running on http://localhost:${port}`);
  logger.log(`Telemetry endpoint: POST /v1/telemetry/meter`);
  logger.log(`Telemetry endpoint: POST /v1/telemetry/vehicle`);
  logger.log(`Analytics endpoint: GET /v1/analytics/performance/:vehicleId`);
}
bootstrap();
