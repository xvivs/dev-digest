# Request lifecycle

How a request travels through `@devdigest/api`, and why the order in
`src/app.ts` is what it is.

## The path

```
HTTP request
  │
  ├─ Fastify core            bodyLimit 1 MB (src/app.ts)
  │
  ├─ plugins                 helmet → cors → SSE → rate-limit
  │                          registered BEFORE modules
  │
  ├─ route schema            zod params/body via fastify-type-provider-zod
  │                          invalid input → 422, handler never runs
  │
  ├─ module plugin           modules/<name>/routes.ts
  │
  ├─ getContext()            modules/_shared/context.ts
  │                          resolves { workspaceId, userId } through AuthProvider
  │
  ├─ service                 modules/<name>/service.ts — business logic, no SQL
  │
  ├─ DI container            platform/container.ts — resolves adapters lazily
  │     ├─ prod              OpenAI · Anthropic · OpenRouter · Octokit · simple-git · ast-grep
  │     └─ tests             src/adapters/mocks.ts via ContainerOverrides
  │
  ├─ repository              Drizzle → Postgres
  │
  └─ response                serialized against the route's zod response schema
```

Long work does not run inline: a service enqueues on `container.jobs`
(`JobRunner`, p-queue, concurrency 3, 120s timeout, 2 retries) and the request
returns immediately. Run progress reaches the browser over SSE
(`GET /runs/:id/events`), and the full log is persisted as one jsonb document in
`run_traces` when the run ends.

## Why the order matters

**Plugins before modules.** Module plugins are encapsulated. Anything registered
after them is invisible to them — so helmet, cors, rate-limit, SSE and the shared
error handler must all be in place first, or modules silently run without them.

**Validation before the handler.** Each route declares zod `params`/`body`, so
bad input is rejected at the edge. Handlers therefore do not call
`Schema.parse(req.body)` themselves; adding one back means the same input can be
rejected in two places with two different status codes.

**Boot-time reaping is awaited before `listen()`.** Runs left `running` by a dead
process would otherwise show as perpetually running and be uncancellable. The
await matters: a fresh process has no in-flight runs of its own (runs only start
via `POST /pulls/:id/review`, which needs the server listening), so every
`running` row at that moment is genuinely orphaned. Awaiting also closes the race
where a brand-new run could be created — and wrongly reaped — in the gap.

> This assumes **one API instance per database**. With replicas, reaping would
> need per-instance scoping or heartbeats.

## Error handling

Registered with `app.setErrorHandler` in `src/app.ts`, before modules. Every
failure leaves as the same envelope: `{ error: { code, message, details? } }`.

| Condition | Status | `code` | Note |
|---|---|---|---|
| `hasZodFastifySchemaValidationErrors(err)` | 422 | `validation_error` | Request failed its route schema; `details` carries `err.validation` |
| `isResponseSerializationError(err)` | 500 | `internal_error` | The *response* failed its own schema. Logged, never returned — leaking the raw object would leak whatever the handler built |
| `ZodError` by `instanceof` **or by shape** | 422 | `validation_error` | Service-level `.parse()` calls and any route not yet on `schema.body` |
| `err instanceof AppError` | `err.statusCode` | `err.code` | `NotFoundError`, `ConfigError`, … in `platform/errors.ts` |
| anything else | `err.statusCode ?? 500` | `internal_error` | Logged in full |

### Why `ZodError` is matched by shape

`instanceof z.ZodError` can be **false for a real ZodError**. The check also
matches on `name === 'ZodError'` plus an `issues`/`errors` array.

The cause is duplicate zod module instances. `@devdigest/shared` is vendored into
the server, and the server has its own `zod` dependency; a schema constructed
against one zod instance throws an error whose prototype chain does not match the
other instance's `ZodError` class. Without the shape check, a genuine validation
failure would fall through to the generic branch and return 500 instead of 422.

This is a direct consequence of the vendored-contracts setup — see
`docs/adr/0001-vendored-shared.md`.

## Health checks

Both bypass the rate limiter and neither belongs to a module.

- `GET /health` — liveness. No DB touch.
- `GET /health/ready` — readiness. Runs `select 1`; on failure returns **503**,
  not 500, so an orchestrator reads it as "not ready yet" rather than "crashed".

## Rate limiting

Global 120 requests/minute, **disabled when `NODE_ENV=test`** so integration
suites can hammer endpoints through `app.inject()`. Expensive endpoints
(e.g. `POST /pulls/:id/review`) declare tighter per-route caps. SSE and the
health routes are exempt.
