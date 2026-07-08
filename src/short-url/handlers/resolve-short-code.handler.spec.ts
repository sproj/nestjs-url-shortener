import { ResolveShortCodeHandler } from './resolve-short-code.handler.js';
import { ResolveShortCodeQuery } from '../queries/resolve-short-code.query.js';
import { ShortUrlRepository } from '../repository/short-url.repository.js';
import { RedisCache } from '../cache/redis-cache.js';
import { ShortUrlEntity } from '../domain/short-url.entity.js';
import { RedirectDecision } from '../domain/redirect-decision.js';

function makeEntity(overrides: Partial<ShortUrlEntity> = {}): ShortUrlEntity {
  return {
    id: 1,
    code: 'abc1234',
    long_url: 'https://example.com',
    expires_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

function makeHandler(
  findByCode: jest.Mock,
  cacheGet: jest.Mock,
  cacheSet: jest.Mock = jest.fn().mockResolvedValue(undefined),
): ResolveShortCodeHandler {
  const repo = { findByCode, insert: jest.fn(), runMigration: jest.fn() } as unknown as ShortUrlRepository;
  const cache = { get: cacheGet, set: cacheSet, delete: jest.fn() } as unknown as RedisCache;
  return new ResolveShortCodeHandler(repo, cache);
}

describe('ResolveShortCodeHandler', () => {
  const query = new ResolveShortCodeQuery('abc1234');

  it('returns cached decision without hitting the DB', async () => {
    const cached: RedirectDecision = { type: 'permanent', longUrl: 'https://example.com' };
    const cacheGet = jest.fn().mockResolvedValue(cached);
    const findByCode = jest.fn();
    const handler = makeHandler(findByCode, cacheGet);

    const result = await handler.execute(query);

    expect(result).toEqual(cached);
    expect(findByCode).not.toHaveBeenCalled();
  });

  it('returns not_found when code is absent from DB', async () => {
    const handler = makeHandler(
      jest.fn().mockResolvedValue(null),
      jest.fn().mockResolvedValue(null),
    );

    const result = await handler.execute(query);

    expect(result).toEqual({ type: 'not_found' });
  });

  it('returns gone when expires_at is in the past', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 5);
    const handler = makeHandler(
      jest.fn().mockResolvedValue(makeEntity({ expires_at: past })),
      jest.fn().mockResolvedValue(null),
    );

    const result = await handler.execute(query);

    expect(result).toEqual({ type: 'gone' });
  });

  it('returns permanent and caches with 6-hour TTL when expires_at is null', async () => {
    const cacheSet = jest.fn().mockResolvedValue(undefined);
    const handler = makeHandler(
      jest.fn().mockResolvedValue(makeEntity({ expires_at: null })),
      jest.fn().mockResolvedValue(null),
      cacheSet,
    );

    const result = await handler.execute(query);

    expect(result).toEqual({ type: 'permanent', longUrl: 'https://example.com' });
    expect(cacheSet).toHaveBeenCalledWith('abc1234', result, 6 * 3600);
  });

  it('returns temporary and caches with clamped TTL when expires_at is in the future', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 5);
    const cacheSet = jest.fn().mockResolvedValue(undefined);
    const handler = makeHandler(
      jest.fn().mockResolvedValue(makeEntity({ expires_at: future })),
      jest.fn().mockResolvedValue(null),
      cacheSet,
    );

    const result = await handler.execute(query);

    expect(result).toEqual({ type: 'temporary', longUrl: 'https://example.com' });

    const ttlArg: number = cacheSet.mock.calls[0][2];
    expect(ttlArg).toBeGreaterThanOrEqual(1);
    expect(ttlArg).toBeLessThanOrEqual(900);
  });

  it('clamps TTL to 900 seconds max when expires_at is far in the future', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const cacheSet = jest.fn().mockResolvedValue(undefined);
    const handler = makeHandler(
      jest.fn().mockResolvedValue(makeEntity({ expires_at: future })),
      jest.fn().mockResolvedValue(null),
      cacheSet,
    );

    await handler.execute(query);

    expect(cacheSet.mock.calls[0][2]).toBe(900);
  });

  it('floors TTL to 1 second when expires_at is almost now', async () => {
    const almostNow = new Date(Date.now() + 500);
    const cacheSet = jest.fn().mockResolvedValue(undefined);
    const handler = makeHandler(
      jest.fn().mockResolvedValue(makeEntity({ expires_at: almostNow })),
      jest.fn().mockResolvedValue(null),
      cacheSet,
    );

    await handler.execute(query);

    expect(cacheSet.mock.calls[0][2]).toBeGreaterThanOrEqual(1);
  });
});
