import { Test, TestingModule } from '@nestjs/testing';
import { CommandBus, CqrsModule, QueryBus } from '@nestjs/cqrs';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ShortUrlController } from './short-url.controller.js';
import { ANALYTICS_PUBLISHER, AnalyticsPublisher, RedirectEvent } from './analytics/analytics-publisher.interface.js';
import { RedirectDecision } from './domain/redirect-decision.js';

function makeResponse() {
  return { redirect: jest.fn() } as any;
}

describe('ShortUrlController — analytics publisher', () => {
  let controller: ShortUrlController;
  let queryBus: { execute: jest.Mock };
  let publisher: { publish: jest.Mock };

  beforeEach(async () => {
    queryBus = { execute: jest.fn() };
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      imports: [CqrsModule],
      controllers: [ShortUrlController],
      providers: [
        { provide: ANALYTICS_PUBLISHER, useValue: publisher as AnalyticsPublisher },
      ],
    })
      .overrideProvider(QueryBus)
      .useValue(queryBus)
      .overrideProvider(CommandBus)
      .useValue({ execute: jest.fn() })
      .compile();

    controller = module.get(ShortUrlController);
  });

  async function resolveWith(decision: RedirectDecision) {
    queryBus.execute.mockResolvedValue(decision);
    return controller.redirect('abc1234', makeResponse());
  }

  it('calls publisher with redirect_type=permanent on permanent decision', async () => {
    await resolveWith({ type: 'permanent', longUrl: 'https://example.com' });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const event: RedirectEvent = publisher.publish.mock.calls[0][0];
    expect(event.redirect_type).toBe('permanent');
    expect(event.code).toBe('abc1234');
    expect(event.long_url).toBe('https://example.com');
    expect(event.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(event.timestamp).toBeTruthy();
  });

  it('calls publisher with redirect_type=temporary on temporary decision', async () => {
    await resolveWith({ type: 'temporary', longUrl: 'https://example.com' });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const event: RedirectEvent = publisher.publish.mock.calls[0][0];
    expect(event.redirect_type).toBe('temporary');
  });

  it('does NOT call publisher on gone decision', async () => {
    queryBus.execute.mockResolvedValue({ type: 'gone' } as RedirectDecision);

    await expect(controller.redirect('abc1234', makeResponse())).rejects.toThrow(HttpException);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('does NOT call publisher on not_found decision', async () => {
    queryBus.execute.mockResolvedValue({ type: 'not_found' } as RedirectDecision);

    await expect(controller.redirect('abc1234', makeResponse())).rejects.toThrow(HttpException);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('returns 301 for permanent redirect', async () => {
    const res = makeResponse();
    queryBus.execute.mockResolvedValue({ type: 'permanent', longUrl: 'https://example.com' });

    await controller.redirect('abc1234', res);

    expect(res.redirect).toHaveBeenCalledWith(301, 'https://example.com');
  });

  it('returns 307 for temporary redirect', async () => {
    const res = makeResponse();
    queryBus.execute.mockResolvedValue({ type: 'temporary', longUrl: 'https://example.com' });

    await controller.redirect('abc1234', res);

    expect(res.redirect).toHaveBeenCalledWith(307, 'https://example.com');
  });

  it('throws 410 Gone for gone decision', async () => {
    queryBus.execute.mockResolvedValue({ type: 'gone' });

    await expect(controller.redirect('abc1234', makeResponse())).rejects.toMatchObject({
      status: HttpStatus.GONE,
    });
  });
});
