import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import amqp from 'amqp-connection-manager';
import { ShortUrlController } from './short-url.controller.js';
import { ShortUrlRepository } from './repository/short-url.repository.js';
import { RedisCache, REDIS_CLIENT } from './cache/redis-cache.js';
import { Base62CodeGenerator } from './code-generator/base62-code-generator.js';
import { CODE_GENERATOR } from './code-generator/code-generator.interface.js';
import { RabbitMqAnalyticsPublisher } from './analytics/rabbitmq-analytics-publisher.js';
import { ANALYTICS_PUBLISHER } from './analytics/analytics-publisher.interface.js';
import { ShortenUrlHandler } from './handlers/shorten-url.handler.js';
import { ResolveShortCodeHandler } from './handlers/resolve-short-code.handler.js';

const handlers = [ShortenUrlHandler, ResolveShortCodeHandler];

@Module({
  imports: [CqrsModule],
  controllers: [ShortUrlController],
  providers: [
    ShortUrlRepository,
    RedisCache,
    ...handlers,
    {
      provide: 'PG_POOL',
      useFactory: (config: ConfigService) =>
        new Pool({
          host: config.get('POSTGRES_HOST', 'localhost'),
          port: parseInt(config.get('POSTGRES_PORT', '5432'), 10),
          database: config.get('POSTGRES_DB', 'url_shortener'),
          user: config.get('POSTGRES_USER', 'postgres'),
          password: config.get('POSTGRES_PASSWORD', ''),
          max: parseInt(config.get('POSTGRES_CONNECTION_POOL', '10'), 10),
        }),
      inject: [ConfigService],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get('REDIS_HOST', 'localhost'),
          port: parseInt(config.get('REDIS_PORT', '6379'), 10),
          lazyConnect: true,
        }),
      inject: [ConfigService],
    },
    {
      provide: CODE_GENERATOR,
      useClass: Base62CodeGenerator,
    },
    {
      provide: ANALYTICS_PUBLISHER,
      useFactory: (config: ConfigService) => {
        const logger = new Logger('AmqpSetup');
        const host = config.get<string>('RABBITMQ_HOST');
        const port = config.get('RABBITMQ_PORT', '5672');
        const exchange = config.get('RABBITMQ_EXCHANGE', '');
        const routingKey = config.get('REDIRECT_EVENT_ROUTING_KEY', 'redirect_events');

        if (!host) {
          logger.warn('RABBITMQ_HOST not set — analytics publishing disabled (no-op publisher)');
          return { publish: async () => {} };
        }

        const connection = amqp.connect([`amqp://${host}:${port}`]);
        connection.on('connect', () => logger.log('RabbitMQ connected'));
        connection.on('disconnect', ({ err }) =>
          logger.warn(`RabbitMQ disconnected: ${err?.message}`),
        );

        const channel = connection.createChannel({ json: false });
        return new RabbitMqAnalyticsPublisher(channel, exchange, routingKey);
      },
      inject: [ConfigService],
    },
  ],
  exports: ['PG_POOL'],
})
export class ShortUrlModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(ShortUrlModule.name);

  constructor(private readonly repo: ShortUrlRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Running DB migration...');
    await this.repo.runMigration();
    this.logger.log('Migration complete');
  }
}
