import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ShortUrlModule } from './short-url/short-url.module.js';
import { HealthController } from './health/health.controller.js';
import { MetricsController } from './metrics/metrics.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ShortUrlModule,
  ],
  controllers: [HealthController, MetricsController],
})
export class AppModule {}
