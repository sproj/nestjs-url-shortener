import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('URL Shortener')
    .setDescription(
      'Core URL shortening service. Scope is intentionally limited to shorten + redirect + analytics. '
    )
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const host = process.env.SERVICE_HOST ?? '0.0.0.0';
  const port = parseInt(process.env.SERVICE_PORT ?? '8080', 10);
  await app.listen(port, host);
}

bootstrap();
