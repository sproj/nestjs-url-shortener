export type RedirectDecision =
  | { type: 'permanent'; longUrl: string }
  | { type: 'temporary'; longUrl: string }
  | { type: 'gone' }
  | { type: 'not_found' };
