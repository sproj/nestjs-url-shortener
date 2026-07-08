export interface ShortUrlEntity {
  id: number;
  code: string;
  long_url: string;
  expires_at: Date | null;
  created_at: Date;
}
