import { Counter, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();

export const cacheHitsTotal = new Counter({
  name: 'redirect_cache_hits_total',
  help: 'Total number of redirect cache hits',
  registers: [metricsRegistry],
});

export const cacheMissesTotal = new Counter({
  name: 'redirect_cache_misses_total',
  help: 'Total number of redirect cache misses',
  registers: [metricsRegistry],
});

export const redirectsTotal = new Counter({
  name: 'redirects_total',
  help: 'Total number of redirect resolutions by result',
  labelNames: ['result'] as const,
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});
