# server — `@devdigest/api`

Fastify 5 + Drizzle over Postgres. Adapters sit behind a DI container so tests
swap them for mocks.

## Module anatomy

One feature = one folder = one Fastify plugin.

```
modules/<name>/
  routes.ts       HTTP surface + zod schemas (the only file Fastify sees)
  service.ts      business logic
  repository.ts   Drizzle queries
  helpers.ts      pure transforms
  constants.ts    literals
```

**To add a module:** create `modules/<name>/routes.ts` with a default Fastify
plugin, then add one import + one entry to `src/modules/index.ts`. Registration
is static on purpose — filesystem autoload breaks under tsx / vitest / bundler,
because native dynamic `import()` of `.ts` is not portable.

## Rules

- Modules never import each other. Shared entities hang off the container:
  `container.agentsRepo`, `container.reviewRepo`, `container.repoIntel`.
- Modules never construct adapters. Resolve from `container` — `container.git`,
  `await container.github()`, `await container.llm(id)`. Lazy by design: no key,
  no client constructed.
- Validation is schema-first. Declare zod `params`/`body` on the route via
  `fastify-type-provider-zod`; invalid input becomes a 422 before the handler
  runs. Do not hand-roll `Schema.parse(req.body)` inside a handler.
- Services hold no raw SQL. Persistence goes through `repository.ts`.
- Every request resolves tenancy through `getContext(container, req)` so
  workspace scoping is never forgotten.
- Route params that address a DB row use `IdParams` from `modules/_shared/schemas.ts`
  (uuid). Non-uuid ids (e.g. `/providers/:id`) declare their own schema.
- Plugins register before modules so encapsulated module plugins inherit helmet,
  cors, rate-limit, SSE and the shared error handler.
- Long work goes through `container.jobs` (`JobRunner`), not inline in a request.
  Handlers are registered by kind at wiring time.

## Gotchas

- `pnpm db:migrate` is manual — nothing migrates on boot.
- `pnpm db:seed` is not optional: `LocalNoAuthProvider` looks up the seeded
  system user and default workspace by name and throws without them.
- A DB-backed test MUST be named `*.it.test.ts`. Anything else is treated as
  hermetic by the CI split and will fail without Docker.
- `JobRunner` has a hard 120s timeout per job; long indexing self-limits below it.

## Do not touch

- `src/vendor/shared/**` — a vendored copy of `@devdigest/shared`. The client has
  its own copy; change both together.
- `src/db/migrations/**` — regenerate with `pnpm db:generate`.
- `src/platform/model-router.ts`, `src/platform/prompts.ts` — written but unwired,
  scaffolding for later lessons.
- `src/platform/prompt.ts`, `grounding.ts`, `structured.ts` are re-export shims
  over `reviewer-core`. Edit the engine, not the shim.

## Read when

- Read `README.md` for the API map, DI flow diagram and env table.
- Read `docs/request-lifecycle.md` before changing plugin order or error handling.
- Read `docs/db-schema-map.md` before adding a table or wondering why one is empty.
- Read `src/modules/repo-intel/README.md` before touching the indexer.
- Read `INSIGHTS.md` before starting work here and note which entries are
  relevant — treat it as high-confidence guidance unless this file says
  otherwise.

## Before you finish

File anything durable you learned this session into `INSIGHTS.md` **through
the `engineering-insights` skill** — don't skip this step, and don't edit the
file by hand. Hand-written entries land undated, unreferenced and in the wrong
section, and nothing catches it until someone audits the file months later.
