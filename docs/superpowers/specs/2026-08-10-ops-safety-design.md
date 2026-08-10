# KhaiDee Ops And Safety Design

Date: 2026-08-10

## Purpose

Prepare KhaiDee for a small real production pilot by adding operational
visibility, failure detection, and recovery practices around the existing API.
This spec covers Codex's lane only: request logging hygiene, error tracking,
uptime monitoring, database backup documentation, slow request/query visibility,
and SSE health signals.

Claude's abuse-control lane owns customer-order caps and anti-spam behavior.
Those controls should use the shared logging/event patterns from this spec, but
their business rules are out of scope here.

## Current Context

The repo is a TypeScript monorepo:

- `apps/api`: Fastify 5 API, Drizzle, Postgres, in-process SSE broker.
- `apps/order`: Vite customer QR ordering page.
- `apps/vendor`: Expo vendor queue app.
- `packages/domain`: pure business rules and shared types.

Relevant current behavior:

- `apps/api/src/app.ts` already has a `/health` route, centralized error
  handler, Fastify logger support, multipart upload handling, and static
  serving for `/uploads/`.
- `apps/api/src/server.ts` enables Fastify logging in the real server.
- `apps/api/src/db/client.ts` falls back to local `khaidee_dev` when
  `DATABASE_URL` is missing.
- `apps/api/src/lib/auth.ts` already refuses production without
  `SESSION_SECRET`.
- README known limits call out local-disk uploads, unverified real AI provider
  calls, and pre-production payment/app validation gaps.

## Goals

- Make production failures diagnosable from logs and error events.
- Make uptime checks able to detect both API process health and database health.
- Add clear signals for SSE stream churn and replay behavior.
- Surface slow requests and database calls before vendors feel them.
- Document a practical backup and restore procedure for the first hosted
  Postgres deployment.
- Fail fast on missing production configuration.
- Keep the first version deploy-provider neutral.

## Non-Goals

- No customer abuse rules, open-order caps, or anti-spam throttles.
- No full metrics stack, tracing backend, or dashboard vendor lock-in.
- No multi-instance SSE broker replacement.
- No migration from local upload disk to object storage.
- No billing/admin work.
- No new app screens.

## Approach Options

### Option A: Minimal Logs Only

Add structured Fastify logs, request ids, and a stronger health endpoint.

Pros:

- Very quick.
- Low dependency risk.
- Useful immediately during pilot.

Cons:

- No external alerting path.
- Slow DB visibility remains weak.
- SSE issues are still hard to diagnose.

### Option B: Pilot-Grade Ops Layer

Add structured logging helpers, request and error hooks, DB health checks, slow
operation logging, SSE lifecycle logs, Sentry-compatible error hooks, and a
backup runbook.

Pros:

- Covers the practical failure modes for a small production pilot.
- Stays provider-neutral.
- Does not require a full observability platform before launch.
- Gives Claude's abuse controls a clean way to log decisions in its separate
  implementation pass.

Cons:

- More implementation work than logs only.
- Alerts still depend on the deployment platform or a connected error monitor.

### Option C: Full Observability Platform

Add OpenTelemetry traces, Prometheus metrics, dashboards, alert rules, SLOs, and
provider-specific deployment monitoring.

Pros:

- Best long-term observability.
- Supports multi-instance production better.

Cons:

- Too much before the first real pilot.
- Requires infrastructure choices the repo has not made yet.
- More maintenance than the product currently needs.

## Recommended Approach

Use Option B. It is the right middle: real production signals, clear failure
handling, and no premature platform dependency.

## Design

### Configuration Validation

Add a production configuration module under `apps/api/src/lib/config.ts` or
extend `env.ts` with typed validation.

In production, require:

- `NODE_ENV=production`
- `DATABASE_URL`
- `SESSION_SECRET`

Optional but validated when present:

- `SENTRY_DSN`
- `UPLOAD_DIR`
- `KHAIDEE_REPORT_AI`
- `ANTHROPIC_API_KEY`
- `XAI_API_KEY`
- `KHAIDEE_REPORT_MODEL`
- `KHAIDEE_ASSISTANT_MODEL`

Rules:

- Local defaults are allowed outside production.
- Production must not silently fall back to local Postgres.
- If report AI or assistant AI is enabled, the matching provider key must be
  present.
- Invalid config should throw during startup, before the server listens.

### Request Logging Hygiene

Add a Fastify logging setup that produces structured records with:

- Request id.
- HTTP method, route, status code, latency.
- Client IP or platform proxy IP field.
- Authenticated vendor id when available.
- Error code for API-shaped errors.
- Sanitized error details.

Do not log:

- Bearer tokens.
- PINs.
- PromptPay IDs.
- Raw AI prompts/history.
- Multipart image bodies.

Implementation shape:

- Add a request id generator if Fastify's default is not enough.
- Add hooks for request start and response completion.
- Add a small sanitizer helper for headers/body/error metadata.
- Preserve the existing centralized error handler.

### Error Tracking

Add an error-reporting adapter with a no-op default and optional Sentry-backed
implementation when `SENTRY_DSN` is set.

Capture:

- Unhandled 5xx errors from the Fastify error handler.
- Startup failures.
- Unexpected SSE send/replay failures.
- Unexpected AI provider failures after they have been mapped to a safe API
  response.

Do not capture:

- Expected 4xx errors like invalid request, unauthorized, upgrade required, or
  sold-out conflicts.
- Secrets or raw request bodies.

The adapter should expose a tiny interface such as:

```ts
interface ErrorReporter {
  capture(error: unknown, context: Record<string, unknown>): void;
}
```

### Health And Uptime Monitoring

Keep `/health` lightweight for process liveness, and add `/ready` for
dependency readiness.

`GET /health`:

- Returns `{ ok: true }` if the process can answer HTTP.
- Does not query the database.

`GET /ready`:

- Runs a cheap DB query such as `select 1`.
- Returns 200 with `{ ok: true, database: "ok" }` when ready.
- Returns 503 with `{ ok: false, database: "error" }` when DB is unavailable.

This supports common hosting setups where liveness and readiness checks have
different meanings.

### Slow Request And Query Visibility

Add request-duration logging:

- Warn for API requests over 1,000 ms.
- Error for API requests over 5,000 ms.
- Include method, route, status code, request id, and vendor id if known.

Add database timing at the service boundary or DB client wrapper:

- Log DB operations over 500 ms.
- Include operation label, request id if available, and elapsed time.
- Avoid logging raw SQL with user data unless it is sanitized.

Start with service-level labels instead of deep ORM instrumentation if that is
faster and clearer.

### SSE Stream Health

Add lifecycle logs/counters around `vendor/stream` and `orders/:id/stream`:

- Stream opened.
- Stream closed.
- Replay started and completed.
- Number of replayed events.
- Last event id seen from the client.
- Send failure.

Add lightweight in-memory counters and emit them in structured logs. Do not add
an internal metrics endpoint in this pass.

- Current vendor streams.
- Current customer streams.
- Total opens since process start.
- Total disconnects since process start.
- Total send failures since process start.

For the pilot, logs are the metrics surface. A future metrics endpoint requires
a separate deployment-target decision.

### Alerting Hooks

The code should emit clear events that an external monitor can alert on:

- Any 5xx error.
- Readiness check failure.
- High slow-request volume.
- SSE send failures.
- Startup config failure.

The first implementation can document alert setup for the chosen host rather
than codifying provider-specific alert rules.

### Database Backups

Add `docs/runbooks/postgres-backup-restore.md` covering:

- Who/what owns automated backups in production.
- Daily backup expectation.
- Point-in-time recovery expectation if supported.
- Manual `pg_dump` command for emergency backup.
- Restore rehearsal command against a non-production database.
- How to verify restored data.
- Escalation notes when restore fails.

Do not add a custom backup daemon unless the hosting provider lacks backups.

## Implementation Checklist

1. Add typed production config validation.
2. Ensure production cannot use local `DATABASE_URL` fallback.
3. Add request id and sanitized structured request logging.
4. Add safe error reporter interface and no-op implementation.
5. Add optional Sentry implementation behind `SENTRY_DSN`.
6. Wire 5xx capture into the existing Fastify error handler.
7. Keep `/health` as liveness.
8. Add `/ready` with DB connectivity check.
9. Add slow request logging threshold.
10. Add service/DB operation timing helper.
11. Add SSE stream lifecycle logging for vendor streams.
12. Add SSE stream lifecycle logging for customer streams.
13. Add in-memory SSE counters and periodic structured log summaries.
14. Add tests for config validation.
15. Add tests for `/health` and `/ready` success/failure behavior.
16. Add tests that expected 4xx errors are not reported as unhandled errors.
17. Add tests that 5xx errors call the error reporter with sanitized context.
18. Add tests or unit coverage for request/error sanitization.
19. Add Postgres backup and restore runbook.
20. Update README production notes with links to the ops runbook/spec.

## Testing Strategy

- Unit test config parsing for dev, test, and production cases.
- Integration test `/health` and `/ready`.
- Integration test error reporting by injecting a fake reporter into `buildApp`.
- Unit test sanitizer behavior for authorization, PIN, PromptPay, and AI fields.
- Unit test slow-operation logging with a fake logger.
- SSE lifecycle coverage can start with lower-level unit tests around the
  tracking helper, avoiding fragile long-running stream tests.

## Handoff Boundary For Claude

Claude can implement abuse controls independently if it follows these contracts:

- Do not change order idempotency: a retry with the same `clientId` should keep
  returning the original order.
- Emit structured logs/events for abuse-control decisions using the request id,
  route, stall slug/vendor id if available, client id, and reason code.
- Do not log customer-entered secrets or raw bodies.
- Return API-shaped errors that the existing error handler can pass through.

## Done Criteria

- Production startup fails without required config.
- Logs are structured and do not leak tokens, PINs, PromptPay IDs, or raw AI
  prompts.
- `/health` and `/ready` have distinct behavior.
- 5xx errors can be captured by an injected reporter.
- Slow requests and SSE stream failures produce clear warning/error logs.
- Backup/restore runbook exists and includes a restore verification procedure.
- Existing tests still pass.
