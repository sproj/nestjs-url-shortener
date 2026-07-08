import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShortenUrlCommand } from '../commands/shorten-url.command.js';
import { ShortUrlRepository, UniqueConstraintError } from '../repository/short-url.repository.js';
import type { CodeGenerator } from '../code-generator/code-generator.interface.js';
import { CODE_GENERATOR } from '../code-generator/code-generator.interface.js';
import { ShortUrlEntity } from '../domain/short-url.entity.js';

@CommandHandler(ShortenUrlCommand)
export class ShortenUrlHandler implements ICommandHandler<ShortenUrlCommand, ShortUrlEntity> {
  private readonly logger = new Logger(ShortenUrlHandler.name);
  private readonly maxRetries: number;

  constructor(
    private readonly repo: ShortUrlRepository,
    @Inject(CODE_GENERATOR) private readonly codeGenerator: CodeGenerator,
    config: ConfigService,
  ) {
    this.maxRetries = parseInt(config.get('MAX_RETRIES', '5'), 10);
  }

  async execute(command: ShortenUrlCommand): Promise<ShortUrlEntity> {
    const { longUrl, expiresAt } = command;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const code = this.codeGenerator.generate();
      this.logger.debug(`Attempt ${attempt}: trying code=${code}`);

      try {
        return await this.repo.insert(code, longUrl, expiresAt);
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          this.logger.warn(`Code conflict on attempt ${attempt}, constraint=${err.constraint}`);
          continue;
        }
        throw err;
      }
    }

    this.logger.error(`Code generation exhausted after ${this.maxRetries} attempts`);
    throw new InternalServerErrorException('Code generation exhausted');
  }
}
