export class ShortenUrlCommand {
  constructor(
    public readonly longUrl: string,
    public readonly expiresAt: Date | null,
  ) {}
}
