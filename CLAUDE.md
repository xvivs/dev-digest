# DevDigest

Local-first AI pull-request reviewer. **Course starter template, not a product** —
the starter does one thing end to end (import a PR → run an agent review); lessons
L01–L08 add the rest. Empty tables, unused i18n files and `T1`/`T2`/`T3` tags are
deliberate scaffolding. Do not "clean them up".

## Stack

Node ≥22 · pnpm ≥10 · TypeScript strict (`noUncheckedIndexedAccess`) · zod 3

- `server/` — Fastify 5 · Drizzle · Postgres 16 + pgvector
- `client/` — Next 15 App Router · React 19 · TanStack Query · Tailwind 4 · next-intl
- `reviewer-core/` — pure TS review engine; no I/O except an injected `LLMProvider`
- `e2e/` — agent-browser (CDP, deterministic, no LLM)

## Commands

Four standalone packages, **no workspace** — `pnpm install` runs per package.

```sh
./scripts/dev.sh                 # postgres + api:3001 + web:3000
cd server && pnpm db:migrate     # NOT run on boot
cd server && pnpm db:seed        # required — auth resolves the seeded user/workspace
cd <pkg>  && pnpm test           # vitest
cd <pkg>  && pnpm typecheck      # in reviewer-core this IS the build
./scripts/e2e.sh                 # hermetic e2e on isolated ports; never touches your dev DB
```

## Where things live

```
server/src/app.ts             plugin order · error handler · boot-time run reaping
server/src/platform/          config · DI container · jobs · SSE bus
server/src/modules/index.ts   static module registry — add a module here
server/src/modules/<name>/    one Fastify plugin per feature
server/src/adapters/          every external call (llm · github · git · astgrep · secrets)
server/src/db/schema/         Drizzle tables, split by domain
reviewer-core/src/            prompt.ts · grounding.ts · review/run.ts
client/src/app/               routes; feature logic in colocated _components/
client/src/lib/               api.ts + every data hook in hooks/
```

## Cross-package rules

- `@devdigest/shared` is vendored **twice** (`server/src/vendor/shared`,
  `client/src/vendor/shared`). No sync script. Change both or they drift further.
- Secrets never enter the DB or `AppConfig` — only `SecretsProvider`
  (`~/.devdigest/secrets.json`, mode 0600).
- A DB-backed test MUST be named `*.it.test.ts` or the CI unit/integration split breaks.
- Cross-package code resolves through tsconfig paths to TypeScript **source**,
  not built artifacts. `reviewer-core` emits no JS.
- Modules never construct adapters and never import each other — resolve
  everything from the DI container.

## Gotchas

- Migrations are not applied on boot. `relation ... does not exist` = you skipped
  `pnpm db:migrate`.
- Without `pnpm db:seed` the API cannot serve a single request — `LocalNoAuthProvider`
  resolves the seeded system user and default workspace by name.
- `runBus` is a module-level singleton; every app instance in a process shares it.
- Boot-time run reaping assumes a single API instance per database.

## Do not touch

- **Never run `docker compose down -v`.** The `-v` drops the `devdigest_pgdata`
  volume with every imported repo and review. To reset, drop and re-migrate the
  database instead.
- `*/src/vendor/**` — vendored copies. Server and client change together, or not at all.
- Unwired schema tables, unused `client/messages/en/*.json`,
  `server/src/platform/model-router.ts`, `server/src/platform/prompts.ts` —
  lesson scaffolding, intentionally unwired.
- `server/src/db/migrations/**` — regenerate with `pnpm db:generate`, never hand-edit.

## Read when

- Read `server/README.md` before touching routes, DI wiring or the request lifecycle.
- Read `reviewer-core/README.md` before changing the prompt, grounding or structured output.
- Read `server/src/modules/repo-intel/README.md` before using or changing the indexer.
- Read `client/README.md` before adding a route or a data hook.
- Read `TESTING.md` before adding a test suite or a CI workflow.
- Read `e2e/README.md` before running the browser suite — it has a seeded-DB precondition.
- Read `docs/adr/` before changing anything the ADRs cover.
- Read the touched package's `INSIGHTS.md` (or the root one for cross-package
  concerns) before starting work there and note which entries are relevant —
  treat it as high-confidence guidance unless that package's `CLAUDE.md` says
  otherwise.
- Read `specs/` — root for cross-package work, else `server|client|reviewer-core` —
  when implementing a lesson feature; the plan lands before the code.
  (`e2e/specs/` is browser flows, not plans.)

## Before you finish

File anything durable you learned this session into the touched package's
`INSIGHTS.md` (or the root one for cross-package findings) **through the
`engineering-insights` skill** — don't skip this step, and don't edit those
files by hand. Hand-written entries land undated, unreferenced and in the
wrong section, and nothing catches it until someone audits the file months
later.
