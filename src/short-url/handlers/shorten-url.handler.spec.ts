import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShortenUrlHandler } from './shorten-url.handler.js';
import { ShortenUrlCommand } from '../commands/shorten-url.command.js';
import { ShortUrlRepository, UniqueConstraintError } from '../repository/short-url.repository.js';
import { CodeGenerator } from '../code-generator/code-generator.interface.js';
import { ShortUrlEntity } from '../domain/short-url.entity.js';

function makeEntity(code: string): ShortUrlEntity {
  return {
    id: 1,
    code,
    long_url: 'https://example.com',
    expires_at: null,
    created_at: new Date(),
  };
}

function makeHandler(
  insertFn: jest.Mock,
  codes: string[],
  maxRetries = 3,
): ShortenUrlHandler {
  const repo = { insert: insertFn, findByCode: jest.fn(), runMigration: jest.fn() } as unknown as ShortUrlRepository;
  let idx = 0;
  const codeGenerator: CodeGenerator = { generate: () => codes[idx++] ?? 'fallback' };
  const config = { get: (_key: string, def: string) => def } as unknown as ConfigService;
  jest.spyOn(config, 'get').mockImplementation((_key: string, def: string) =>
    _key === 'MAX_RETRIES' ? String(maxRetries) : def,
  );
  return new ShortenUrlHandler(repo, codeGenerator, config);
}

describe('ShortenUrlHandler', () => {
  const command = new ShortenUrlCommand('https://example.com', null);

  it('returns entity on first successful insert', async () => {
    const entity = makeEntity('abc1234');
    const insert = jest.fn().mockResolvedValue(entity);
    const handler = makeHandler(insert, ['abc1234']);

    const result = await handler.execute(command);

    expect(result).toBe(entity);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith('abc1234', 'https://example.com', null);
  });

  it('retries on unique constraint and succeeds on second attempt', async () => {
    const entity = makeEntity('second1');
    const insert = jest
      .fn()
      .mockRejectedValueOnce(new UniqueConstraintError('short_url_code_key'))
      .mockResolvedValueOnce(entity);
    const handler = makeHandler(insert, ['first01', 'second1']);

    const result = await handler.execute(command);

    expect(result).toBe(entity);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toBe('first01');
    expect(insert.mock.calls[1][0]).toBe('second1');
  });

  it('throws InternalServerErrorException when retries are exhausted', async () => {
    const insert = jest.fn().mockRejectedValue(new UniqueConstraintError('short_url_code_key'));
    const handler = makeHandler(insert, ['c1', 'c2', 'c3'], 3);

    await expect(handler.execute(command)).rejects.toThrow(InternalServerErrorException);
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it('re-throws non-constraint errors immediately', async () => {
    const dbError = new Error('connection lost');
    const insert = jest.fn().mockRejectedValue(dbError);
    const handler = makeHandler(insert, ['abc1234']);

    await expect(handler.execute(command)).rejects.toThrow('connection lost');
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
