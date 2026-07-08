# NestJS URL Shortener

A NestJS port of the core domain from the Rust `url-shortener` service, built as an interview/infrastructure demo. The emphasis is on the infrastructure story — CQRS layering, raw-SQL repository, Redis caching, RabbitMQ interop, Prometheus metrics, Swagger — rather than feature breadth.

## Scope

This service implements exactly three operations and nothing else:

| Operation | Endpoint |
|---|---|
| Shorten a URL | `POST /shorten` |
| Resolve a short code and redirect | `GET /r/:code` |
| Publish a redirect analytics event | side effect of `GET /r/:code` |

Auth, vanity codes, update, and delete are intentionally absent. The Rust service has those features; they are out of scope here by design, not by omission.

## Quick start

### With Docker Compose (recommended)

```bash
cp .env.example .env          # fill in any values you want to change
docker compose up --build
```

The app is available at `http://localhost:8080`.

Infra UIs:
- RabbitMQ management: `http://localhost:15672` (guest / guest)
- RedisInsight: `http://localhost:5540`

### Running locally against Docker infra

```bash
# Start only infra
docker compose up postgres redis rabbitmq -d

# Install and run the app
npm install
cp .env.example .env
npm run start:dev
```

## Endpoints

### `POST /shorten`

Shorten a URL. `expires_at` is optional; omitting it creates a permanent redirect.

```http
POST /shorten
Content-Type: application/json

{
  "long_url": "https://example.com/some/long/path",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

**201 Created**
```json
{
  "id": 1,
  "code": "aB3xY7z",
  "long_url": "https://example.com/some/long/path",
  "expires_at": "2026-12-31T23:59:59.000Z",
  "created_at": "2026-07-08T12:00:00.000Z"
}
```

**400** — `long_url` is not a valid URL.  
**500** — Short code generation exhausted after `MAX_RETRIES` attempts (extremely rare).

---

### `GET /r/:code`

Resolve a short code. Response depends on the link's state:

| Link state | Status | Body |
|---|---|---|
| Not found | 404 | JSON error |
| Expired (`expires_at` in the past) | 410 Gone | JSON error |
| Permanent (`expires_at` is null) | 301 | `Location` header |
| Temporary (`expires_at` in the future) | 307 | `Location` header |

On a 301 or 307, a `RedirectEvent` is published to RabbitMQ (fire-and-forget — a publish failure is logged but never propagates to the caller).

---

### Observability endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness probe — always 200 |
| `GET /ready` | Readiness probe — 200 if DB is reachable, 503 otherwise |
| `GET /metrics` | Prometheus text format |
| `GET /api-docs` | Swagger UI |

## Architecture

```
src/
├── app.module.ts
├── main.ts                        # Swagger, ValidationPipe, SERVICE_PORT
├── short-url/
│   ├── short-url.module.ts        # wires CqrsModule, pg Pool, Redis, AMQP, migration
│   ├── short-url.controller.ts    # POST /shorten · GET /r/:code
│   ├── commands/                  # ShortenUrlCommand
│   ├── queries/                   # ResolveShortCodeQuery
│   ├── handlers/                  # ShortenUrlHandler · ResolveShortCodeHandler
│   ├── domain/                    # ShortUrlEntity · RedirectDecision (discriminated union)
│   ├── repository/                # raw pg Pool, UniqueConstraintError
│   ├── cache/                     # ioredis wrapper
│   ├── code-generator/            # CodeGenerator interface + Base62CodeGenerator
│   └── analytics/                 # AnalyticsPublisher interface + RabbitMqAnalyticsPublisher
├── health/                        # GET /health · GET /ready
└── metrics/                       # GET /metrics (prom-client)
```

**Key design choices that mirror the Rust service:**

- **Raw SQL** (`pg` Pool, no ORM) — same low-abstraction style as the Rust `deadpool-postgres` repository
- **Injectable interfaces** for `CodeGenerator` and `AnalyticsPublisher` — mirrors the Rust `CodeGenerator` trait and `AnalyticsPublisherTrait`; makes both swappable in tests without mocking frameworks
- **Self-migrating startup** — `CREATE TABLE IF NOT EXISTS` runs on `onApplicationBootstrap`, matching the Rust service's behaviour
- **RabbitMQ topology not declared here** — the analytics-consumer owns and declares the exchange/queue/DLQ; this service only publishes

### Redirect decision logic

Mirrors the Rust `RedirectDecision` enum directly:

| DB state | Response | Redis cached? |
|---|---|---|
| Code not in DB | 404 | No |
| `expires_at` in the past | 410 Gone | No |
| `expires_at` is null | 301 Permanent | Yes — 6-hour TTL |
| `expires_at` in the future | 307 Temporary | Yes — TTL = `min(seconds_until_expiry, 900)`, floor 1 s |

Cache writes are best-effort: a Redis failure is logged and does not affect the redirect response.

### Analytics event shape

Matches the existing analytics-consumer contract exactly:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "aB3xY7z",
  "long_url": "https://example.com/some/long/path",
  "timestamp": "2026-07-08T12:00:00.000Z",
  "redirect_type": "permanent"
}
```

`redirect_type` is `"permanent"` or `"temporary"`. Events are **not** published for 404 or 410 responses.

### Prometheus metrics

| Metric | Type | Labels |
|---|---|---|
| `redirect_cache_hits_total` | Counter | — |
| `redirect_cache_misses_total` | Counter | — |
| `redirects_total` | Counter | `result` (permanent / temporary / gone / not_found) |
| `http_requests_total` | Counter | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | Histogram | `method`, `route` |

## Config

Env var names match the Rust service's Kubernetes ConfigMap so the same manifests can target this image with a new container image reference.

| Variable | Default | Notes |
|---|---|---|
| `SERVICE_HOST` | `0.0.0.0` | |
| `SERVICE_PORT` | `8080` | |
| `POSTGRES_HOST` | — | required |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DB` | — | required |
| `POSTGRES_USER` | — | required |
| `POSTGRES_PASSWORD` | — | required |
| `POSTGRES_CONNECTION_POOL` | `10` | |
| `REDIS_HOST` | — | required |
| `REDIS_PORT` | `6379` | |
| `RABBITMQ_HOST` | — | optional — omit to disable analytics |
| `RABBITMQ_PORT` | `5672` | |
| `RABBITMQ_EXCHANGE` | `""` | |
| `REDIRECT_EVENT_ROUTING_KEY` | `redirect_events` | |
| `MAX_RETRIES` | `5` | max code generation attempts before 500 |

Copy `.env.example` to `.env` for local development.

## Testing

```bash
npm test           # unit tests (watch: npm run test:watch)
npm run test:cov   # with coverage report
```

**Handler tests** (`handlers/*.spec.ts`):
- `ShortenUrlHandler` — success on first try, retry on unique-constraint conflict, `InternalServerErrorException` when retries exhausted, non-constraint errors rethrown immediately
- `ResolveShortCodeHandler` — cache hit (no DB call), not_found, gone, permanent with 6-hour TTL cache write, temporary with `min(ttl, 900)` clamping, TTL floor of 1 s

**Controller tests** (`short-url.controller.spec.ts`):
- `AnalyticsPublisher.publish` called with correct `event_id` (UUID v4), `code`, `long_url`, `redirect_type` on permanent and temporary decisions
- Publisher **not** called on 404 or 410 responses
- Correct HTTP status codes (301, 307, 404, 410)

## Development scripts

```bash
npm run start:dev    # watch mode
npm run build        # compile TypeScript
npm run lint         # ESLint
npm run format       # Prettier
```
