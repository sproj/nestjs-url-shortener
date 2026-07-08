# NestJS URL Shortener

A NestJS port of the core domain from the Rust `url-shortener` service.

## Deliberate Scope

This service implements exactly three operations:

| Operation | Endpoint |
|-----------|----------|
| Shorten a URL | `POST /shorten` |
| Resolve and redirect | `GET /r/:code` |
| Publish redirect analytics to RabbitMQ | (side effect of the redirect) |

**Auth, vanity codes, update, and delete are intentionally absent.** This is a complete service for these three operations, not a partial one awaiting the rest. The Rust service has those features; this port exists to demonstrate the infrastructure story (CQRS layering, raw-SQL repository, Redis caching, RabbitMQ interop, Prometheus metrics, Swagger) without domain breadth being the point.

## Architecture

- **CQRS**: `@nestjs/cqrs` with `ShortenUrlCommand` / `ResolveShortCodeQuery` — no event sourcing, no sagas
- **Data access**: Raw `pg` Pool — no ORM, matching the Rust service's own low-abstraction style
- **Cache**: `ioredis` wrapped in a thin `RedisCache` class (get/set/delete)
- **Analytics**: `amqp-connection-manager` publishing to an existing exchange/routing key; topology is owned by the analytics-consumer, not declared here
- **Metrics**: `prom-client` at `GET /metrics` — metric names match the Rust service where feasible (`redirect_cache_hits_total`, `redirect_cache_misses_total`, `redirects_total{result}`)
- **Code generator**: injectable `CodeGenerator` interface with a base62 implementation (7-char codes, ~3.5 trillion combinations)

### Redirect decision logic (mirrors Rust `RedirectDecision` enum)

| DB state | HTTP | Cached? |
|---|---|---|
| Not found | 404 | No |
| `expires_at` in the past | 410 Gone | No |
| `expires_at` is null | 301 Permanent | Yes, 6-hour TTL |
| `expires_at` in the future | 307 Temporary | Yes, TTL = min(seconds until expiry, 900), floor 1s |

## Config (env vars)

Matches the existing Rust service's ConfigMap so the same k8s manifests can target this image:

```
SERVICE_HOST                 (default 0.0.0.0)
SERVICE_PORT                 (default 8080)
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_CONNECTION_POOL
REDIS_HOST
REDIS_PORT
RABBITMQ_HOST                (optional — omit to disable analytics publishing)
RABBITMQ_PORT
RABBITMQ_EXCHANGE
REDIRECT_EVENT_ROUTING_KEY
MAX_RETRIES                  (default 5)
```

`RABBITMQ_HOST` is optional — if absent, analytics publishing degrades to a no-op and the service still starts.

## Running locally

```bash
npm install
npm run build
SERVICE_PORT=8080 POSTGRES_HOST=localhost POSTGRES_DB=url_shortener \
  POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \
  REDIS_HOST=localhost node dist/main
```

API docs at `http://localhost:8080/api-docs`.
Health: `GET /health`, `GET /ready`.
Metrics: `GET /metrics`.

## Tests

```bash
npm test
```

Covers:
- `ShortenUrlHandler`: success, retry-on-conflict, exhausted retries, non-constraint errors rethrown
- `ResolveShortCodeHandler`: cache hit, not_found, gone (expired), permanent + 6h TTL cache write, temporary + clamped TTL, TTL floor/ceiling
- `ShortUrlController`: analytics publisher called with correct shape on permanent/temporary; NOT called on gone/not_found; correct HTTP status codes
