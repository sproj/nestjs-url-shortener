import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { ResolveShortCodeQuery } from '../queries/resolve-short-code.query.js';
import { ShortUrlRepository } from '../repository/short-url.repository.js';
import { RedisCache } from '../cache/redis-cache.js';
import { RedirectDecision } from '../domain/redirect-decision.js';
import {
  cacheHitsTotal,
  cacheMissesTotal,
  redirectsTotal,
} from '../../metrics/metrics.registry.js';

const PERMANENT_TTL_SECONDS = 6 * 3600;
const MAX_TEMPORARY_TTL_SECONDS = 900;

@QueryHandler(ResolveShortCodeQuery)
export class ResolveShortCodeHandler
  implements IQueryHandler<ResolveShortCodeQuery, RedirectDecision>
{
  private readonly logger = new Logger(ResolveShortCodeHandler.name);

  constructor(
    private readonly repo: ShortUrlRepository,
    private readonly cache: RedisCache,
  ) {}

  async execute(query: ResolveShortCodeQuery): Promise<RedirectDecision> {
    const { code } = query;

    const cached = await this.cache.get(code);
    if (cached) {
      this.logger.debug(`Cache hit for code=${code}`);
      cacheHitsTotal.inc();
      return cached;
    }

    this.logger.debug(`Cache miss for code=${code}, checking DB`);
    cacheMissesTotal.inc();

    const entity = await this.repo.findByCode(code);

    if (!entity) {
      redirectsTotal.inc({ result: 'not_found' });
      return { type: 'not_found' };
    }

    if (entity.expires_at && entity.expires_at < new Date()) {
      redirectsTotal.inc({ result: 'gone' });
      return { type: 'gone' };
    }

    if (!entity.expires_at) {
      const decision: RedirectDecision = { type: 'permanent', longUrl: entity.long_url };
      this.cache.set(code, decision, PERMANENT_TTL_SECONDS).catch((err) =>
        this.logger.error(`Cache write failed for code=${code}`, err),
      );
      redirectsTotal.inc({ result: 'permanent' });
      return decision;
    }

    const secondsUntilExpiry = Math.max(
      1,
      Math.floor((entity.expires_at.getTime() - Date.now()) / 1000),
    );
    const ttl = Math.min(secondsUntilExpiry, MAX_TEMPORARY_TTL_SECONDS);
    const decision: RedirectDecision = { type: 'temporary', longUrl: entity.long_url };
    this.cache.set(code, decision, ttl).catch((err) =>
      this.logger.error(`Cache write failed for code=${code}`, err),
    );
    redirectsTotal.inc({ result: 'temporary' });
    return decision;
  }
}
