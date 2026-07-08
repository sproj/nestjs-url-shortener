import { Controller, Get, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Pool } from 'pg';

@ApiTags('ops')
@Controller()
export class HealthController {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200 })
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB connectivity' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 503, description: 'Service unavailable' })
  async ready(): Promise<{ status: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      throw new HttpException('Database unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
