import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ShortUrlEntity } from '../domain/short-url.entity.js';

export class UniqueConstraintError extends Error {
  constructor(public readonly constraint: string) {
    super(`Unique constraint violation: ${constraint}`);
  }
}

@Injectable()
export class ShortUrlRepository {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async findByCode(code: string): Promise<ShortUrlEntity | null> {
    const result = await this.pool.query<ShortUrlEntity>(
      'SELECT id, code, long_url, expires_at, created_at FROM short_url WHERE code = $1',
      [code],
    );
    return result.rows[0] ?? null;
  }

  async insert(
    code: string,
    longUrl: string,
    expiresAt: Date | null,
  ): Promise<ShortUrlEntity> {
    try {
      const result = await this.pool.query<ShortUrlEntity>(
        `INSERT INTO short_url (code, long_url, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, code, long_url, expires_at, created_at`,
        [code, longUrl, expiresAt],
      );
      return result.rows[0];
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new UniqueConstraintError(err.constraint ?? 'unknown');
      }
      throw err;
    }
  }

  async runMigration(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS short_url (
        id         BIGSERIAL    PRIMARY KEY,
        code       TEXT         NOT NULL UNIQUE,
        long_url   TEXT         NOT NULL,
        expires_at TIMESTAMPTZ  NULL,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
  }
}
