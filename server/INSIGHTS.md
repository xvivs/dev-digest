# INSIGHTS — server

Append-only journal of things that cost us time in `@devdigest/api`. Write here
**first** and without a filter: an entry is cheap, a line in `CLAUDE.md` is not.

Findings that cross package boundaries go in the repo-root `../INSIGHTS.md`.
Indexer findings go in `src/modules/repo-intel/INSIGHTS.md`.

Priority: anything that surprised you, broke in a non-obvious way, or where the
obvious fix turned out to be wrong.

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly cleanup —
lives in the engineering-insights skill).

## What Works

## What Doesn't Work

- **Running `pnpm db:migrate` against the shared `devdigest-postgres` docker container can fail with "column already exists"** — every worktree/branch on this course points at the SAME long-lived container (`docker ps` shows one `devdigest-postgres` regardless of branch), so its `__drizzle_migrations` history can be far ahead of this branch's local `src/db/migrations/*.sql` (e.g. `agent_runs.cost_usd` already existed there from another lesson's branch, but without `cost_source`). Check first with `docker exec devdigest-postgres psql -U devdigest -d devdigest -c '\d <table>'`; validate a new migration via the testcontainers-backed `*.it.test.ts` suite (fresh throwaway Postgres per run, `test/helpers/pg.ts`) instead of assuming the shared dev DB is safe to ALTER. _(2026-09-19)_

## Codebase Patterns

## Tool & Library Notes

- **`pnpm exec <bin>` / `pnpm run <script>` can fail non-interactively with `ERR_PNPM_IGNORED_BUILDS` even when `node_modules` is already correct** — both `pnpm db:generate` and `pnpm exec drizzle-kit generate` refused to run this way, erroring "Run \"pnpm approve-builds\" to pick which dependencies should be allowed to run scripts." Workaround: invoke the wrapper under `node_modules/.bin/` directly with `sh`, e.g. `sh node_modules/.bin/drizzle-kit generate`, `sh node_modules/.bin/tsx src/db/migrate.ts`, `sh node_modules/.bin/vitest run` — bypasses pnpm's pre-flight check entirely. _(2026-09-19)_

- **drizzle-orm 0.38.x pg-core index columns take `.desc()`/`.asc()` directly inside `.on(...)`** — `index('agent_runs_pr_ran_at_idx').on(t.prId, t.ranAt.desc())` (`server/src/db/schema/runs.ts`) generated `CREATE INDEX ... USING btree (pr_id, ran_at DESC NULLS LAST)` via `pnpm db:generate`, even though no other schema file in this repo had a prior example of a descending index column to copy. _(2026-09-19)_

## Recurring Errors & Fixes

## Session Notes

### 2026-09-19 — Cost Badge (server) session
Implemented cost provenance persistence end to end: `agent_runs.cost_usd`/`cost_source` columns + `(pr_id, ran_at DESC)` index, contract fields on `RunStats`/`RunSummary`/`PrMeta` (`.nullish()` since `RunStats` is embedded in the `run_traces.trace` jsonb and old documents lack the keys entirely), adapter wiring (openai/anthropic/mocks through `pickCost`), run-executor persistence across the happy/fail-all/catch paths, a PR-list latest-run-cost lookup mirroring the existing `latestReviewByPr` pattern (`pulls/routes.ts`), and seed data covering all three UI states (provider / estimated / no-cost) on PR #482. Did not apply the generated migration to the shared dev Postgres container — see What Doesn't Work; validated instead via testcontainers-backed integration tests (7 files, 31 tests, all passing).

## Open Questions
