import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // Create hybrid application (HTTP + MQTT)
  const app = await NestFactory.create(AppModule);

  // Enable global validation for all DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error on unknown properties
      transform: true, // Auto-transform payloads to DTO instances
    }),
  );

  // Connect MQTT microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    },
  });

  // Start both HTTP and MQTT listeners
  await app.startAllMicroservices();
  
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  
  logger.log(`Smart EV Analytics API running on http://localhost:${port}`);
  logger.log(`MQTT broker connected: ${process.env.MQTT_URL ?? 'mqtt://localhost:1883'}`);
  logger.log(`Analytics endpoint: GET /v1/analytics/performance/:vehicleId`);
}
bootstrap();
