import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedirectDecision } from '../domain/redirect-decision.js';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class RedisCache {
  private readonly logger = new Logger(RedisCache.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(code: string): Promise<RedirectDecision | null> {
    const raw = await this.redis.get(code);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RedirectDecision;
    } catch {
      this.logger.warn(`Failed to parse cached value for ${code}`);
      return null;
    }
  }

  async set(code: string, decision: RedirectDecision, ttlSeconds: number): Promise<void> {
    await this.redis.set(code, JSON.stringify(decision), 'EX', ttlSeconds);
  }

  async delete(code: string): Promise<void> {
    await this.redis.del(code);
  }
}
