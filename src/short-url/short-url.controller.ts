import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUrl } from 'class-validator';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { ShortenUrlCommand } from './commands/shorten-url.command.js';
import { ResolveShortCodeQuery } from './queries/resolve-short-code.query.js';
import { ShortUrlEntity } from './domain/short-url.entity.js';
import {
  ANALYTICS_PUBLISHER,
} from './analytics/analytics-publisher.interface.js';
import type {
  AnalyticsPublisher,
  RedirectEvent,
} from './analytics/analytics-publisher.interface.js';

class ShortenUrlDto {
  @IsUrl({}, { message: 'long_url must be a valid URL' })
  long_url: string;

  @IsOptional()
  @IsISO8601()
  expires_at?: string | null;
}

@ApiTags('url-shortener')
@Controller()
export class ShortUrlController {
  private readonly logger = new Logger(ShortUrlController.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    @Inject(ANALYTICS_PUBLISHER) private readonly analyticsPublisher: AnalyticsPublisher,
  ) {}

  @Post('shorten')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Shorten a URL' })
  @ApiBody({ type: ShortenUrlDto })
  @ApiResponse({ status: 201, description: 'Short URL created' })
  @ApiResponse({ status: 400, description: 'Invalid URL' })
  @ApiResponse({ status: 500, description: 'Code generation exhausted' })
  async shorten(@Body() dto: ShortenUrlDto): Promise<ShortUrlEntity> {
    const expiresAt = dto.expires_at ? new Date(dto.expires_at) : null;
    return this.commandBus.execute<ShortenUrlCommand, ShortUrlEntity>(
      new ShortenUrlCommand(dto.long_url, expiresAt),
    );
  }

  @Get('r/:code')
  @ApiOperation({ summary: 'Resolve a short code and redirect' })
  @ApiParam({ name: 'code', type: String })
  @ApiResponse({ status: 301, description: 'Permanent redirect' })
  @ApiResponse({ status: 307, description: 'Temporary redirect' })
  @ApiResponse({ status: 404, description: 'Code not found' })
  @ApiResponse({ status: 410, description: 'Link has expired' })
  async redirect(@Param('code') code: string, @Res() res: Response): Promise<void> {
    const decision = await this.queryBus.execute(new ResolveShortCodeQuery(code));

    switch (decision.type) {
      case 'not_found':
        throw new NotFoundException(`Short code '${code}' not found`);

      case 'gone':
        throw new HttpException('Link has expired', HttpStatus.GONE);

      case 'permanent': {
        const event: RedirectEvent = {
          event_id: randomUUID(),
          code,
          long_url: decision.longUrl,
          timestamp: new Date().toISOString(),
          redirect_type: 'permanent',
        };
        this.analyticsPublisher
          .publish(event)
          .catch((err) => this.logger.error('Analytics publish failed', err));
        res.redirect(301, decision.longUrl);
        break;
      }

      case 'temporary': {
        const event: RedirectEvent = {
          event_id: randomUUID(),
          code,
          long_url: decision.longUrl,
          timestamp: new Date().toISOString(),
          redirect_type: 'temporary',
        };
        this.analyticsPublisher
          .publish(event)
          .catch((err) => this.logger.error('Analytics publish failed', err));
        res.redirect(307, decision.longUrl);
        break;
      }
    }
  }
}
