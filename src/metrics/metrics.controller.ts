import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { metricsRegistry } from './metrics.registry.js';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  @Get()
  async metrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  }
}
