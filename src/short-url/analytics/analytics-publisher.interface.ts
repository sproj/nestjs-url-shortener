export const ANALYTICS_PUBLISHER = 'ANALYTICS_PUBLISHER';

export type RedirectType = 'permanent' | 'temporary';

export interface RedirectEvent {
  event_id: string;
  code: string;
  long_url: string;
  timestamp: string;
  redirect_type: RedirectType;
}

export interface AnalyticsPublisher {
  publish(event: RedirectEvent): Promise<void>;
}
