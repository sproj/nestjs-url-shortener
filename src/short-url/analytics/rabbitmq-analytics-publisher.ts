import { Logger } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { AnalyticsPublisher, RedirectEvent } from './analytics-publisher.interface.js';

export class RabbitMqAnalyticsPublisher implements AnalyticsPublisher {
  private readonly logger = new Logger(RabbitMqAnalyticsPublisher.name);

  constructor(
    private readonly channel: ChannelWrapper,
    private readonly exchange: string,
    private readonly routingKey: string,
  ) {}

  async publish(event: RedirectEvent): Promise<void> {
    const payload = Buffer.from(JSON.stringify(event));
    await this.channel.publish(this.exchange, this.routingKey, payload, {
      contentType: 'application/json',
    });
    this.logger.debug(`Published redirect event for code=${event.code}`);
  }
}
