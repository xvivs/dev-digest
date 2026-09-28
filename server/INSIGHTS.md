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

- **Verify seed changes on a throwaway database created inside the existing container, not on the dev DB** — the per-PR `if (!pr)` guards in `src/db/seed.ts` mean findings or columns added to the seed never appear on a database seeded earlier, so a re-seed silently "works" and proves nothing. `docker exec devdigest-postgres psql -U devdigest -d postgres -c 'CREATE DATABASE <tmp>'`, then point `DATABASE_URL` at it for `tsx src/db/migrate.ts` + `tsx src/db/seed.ts` and run the API on a spare port. Reuses the running container, leaves `devdigest` untouched, and needs no `docker compose down -v`. Drop it afterwards — the API holds connections open, so stop it first or the DROP fails with "being accessed by other users". _(2026-09-20)_

- **A `drizzle-kit generate --custom` backfill can be tested without a partial-migration harness: replay the SQL file inside an `*.it.test.ts`** — testcontainers applies every migration to an empty DB (`test/helpers/pg.ts:41`), so the DML in `0016_skill_versions_backfill.sql` never touches a row there. `test/skills-versions.it.test.ts` inserts the legacy shape (skill without snapshot, snapshot with NULL metadata), splits the file on `--> statement-breakpoint`, runs each piece with `db.execute(sql.raw(stmt))` twice, and asserts the result, which also proves idempotence. _(2026-09-29)_

## What Doesn't Work

- **Running `pnpm db:migrate` against the shared `devdigest-postgres` docker container can fail with "column already exists"** — every worktree/branch on this course points at the SAME long-lived container (`docker ps` shows one `devdigest-postgres` regardless of branch), so its `__drizzle_migrations` history can be far ahead of this branch's local `src/db/migrations/*.sql` (e.g. `agent_runs.cost_usd` already existed there from another lesson's branch, but without `cost_source`). Check first with `docker exec devdigest-postgres psql -U devdigest -d devdigest -c '\d <table>'`; validate a new migration via the testcontainers-backed `*.it.test.ts` suite (fresh throwaway Postgres per run, `test/helpers/pg.ts`) instead of assuming the shared dev DB is safe to ALTER. _(2026-09-19)_

- **Guarding a seed backfill with `isNull(<column>)` strands every column added to that backfill later** — the review→run pass in `src/db/seed.ts` used `WHERE run_id IS NULL`, which passes once and blocks forever after. Adding `agentId` alongside `runId` then did nothing on any already-seeded database, and the Review-runs card kept rendering the literal "Agent" while the timeline row right above it named the reviewer. Values re-derived from a deterministic lookup should be rewritten unconditionally — the UPDATE is a no-op when they already match. _(2026-09-20)_

## Codebase Patterns

- **Seed rows created inside one `if (!row)` guard are invisible to the next guard, so cross-entity links need their own idempotent pass** — `src/db/seed.ts` creates each review inside `if (!pr) { … }` and the runs inside `if (!existingRun) { … }`, so neither block can see the other's `.returning()` value, and `runs[0].id` does not compile under `noUncheckedIndexedAccess` anyway. Pattern that works: a separate loop after both blocks that re-selects the newest `status='done'` run per PR and updates `reviews` from it. Do NOT guard that update with `WHERE run_id IS NULL` — the pass carries `agent_id` too, and an `isNull` guard on one column silently strands every column added to the pass later (see What Doesn't Work). Re-deriving from a deterministic lookup makes the UPDATE a no-op when the values already match, so it stays idempotent without a guard. _(2026-09-20)_

- **Seeded run counters are copied into `run_traces`, so they must be edited in the `.values([...])` literal, not by a follow-up UPDATE** — `seed.ts` builds `trace.stats.findings` from `.returning()` on the `agent_runs` insert. An UPDATE after the fact fixes the row but leaves the trace document behind, and the run drawer then shows a different finding count than the list. _(2026-09-20)_

- **`dependency-cruiser` in server deps is a runtime library for the repo-intel indexer, not an architecture lint of our own code** — `server/src/adapters/depgraph/index.ts:17` imports `cruise()` to graph *target* repos; there is no `.dependency-cruiser.*` config and no arch-check script, so an import-boundary lint would be a new, separate usage and must not share config with the `DepGraph` adapter. _(2026-09-28)_

- **No production code uses `db.transaction(` — multi-step writes are non-atomic** — e.g. `server/src/modules/reviews/repository/run.repo.ts:92-105` (`deleteAgentRun`) deletes `reviews` then `agentRuns` in two independent queries although its comment requires both. A Drizzle `tx` is structurally a `Db`, so `new ReviewRepository(tx)` inside `db.transaction` works, but never use `container.reviewRepo` there: it memoizes a `db`-bound instance (`server/src/platform/container.ts:99-100`). _(2026-09-28)_

- **The pgvector extension is created by the migrate script, not by a migration file** — `server/src/db/migrate.ts:23` runs `CREATE EXTENSION IF NOT EXISTS vector` before migrations; grepping only `src/db/migrations/` gives a false "extension missing". _(2026-09-28)_

## Tool & Library Notes

- **`pnpm exec <bin>` / `pnpm run <script>` can fail non-interactively with `ERR_PNPM_IGNORED_BUILDS` even when `node_modules` is already correct** — both `pnpm db:generate` and `pnpm exec drizzle-kit generate` refused to run this way, erroring "Run \"pnpm approve-builds\" to pick which dependencies should be allowed to run scripts." Workaround: invoke the wrapper under `node_modules/.bin/` directly with `sh`, e.g. `sh node_modules/.bin/drizzle-kit generate`, `sh node_modules/.bin/tsx src/db/migrate.ts`, `sh node_modules/.bin/vitest run` — bypasses pnpm's pre-flight check entirely. _(2026-09-19)_

- **A `.desc()` index column is documentation, not speed — but a composite covering index for a `GROUP BY` is real, and it degrades under row churn** — measured on a throwaway pg16 (202k `reviews`, 24k `findings`) against the exact `GET /repos/:id/pulls` queries. (1) `reviews(pr_id, created_at DESC)` benchmarks identically to `(pr_id, created_at)` ascending — PG reads the ascending index backwards (`Index Scan Backward`), 0.025 ms either way. And on the list query itself the `created_at` column earns nothing at all: PG16 cannot return ordered rows through a ScalarArrayOp (`pr_id IN (…)`) scan, so all of `(pr_id)`, `(pr_id, created_at)` and `(pr_id, created_at DESC)` produce the same Bitmap scan + Sort at 0.15 ms. The column pays off only on the single-PR path (`pr_id = ?`), where it drops the Sort. (2) `findings(review_id, severity)` genuinely beats `(review_id)` on `GROUP BY review_id, severity`: 0.158 ms (index-only scan + GroupAggregate, 0 heap fetches) vs 0.343 ms (bitmap heap scan + HashAggregate), for 448 kB vs 240 kB. But accept/dismiss writes stale the visibility map, and the plan then drops to a bitmap heap scan at 0.29 ms — the single-column index's number. Floor equals `(review_id)`, ceiling is ~2x, autovacuum decides which you get. (3) The bigger, unasked-for win: neither `findings.review_id` nor `reviews.pr_id` had an index at all, and PG never auto-indexes FK columns — cascade-deleting 20 reviews spent 13.8 ms in `findings_review_id_fkey` before, 0.6 ms after. _(2026-09-20)_

- **drizzle-orm 0.38.x pg-core index columns take `.desc()`/`.asc()` directly inside `.on(...)`** — `index('agent_runs_pr_ran_at_idx').on(t.prId, t.ranAt.desc())` (`server/src/db/schema/runs.ts`) generated `CREATE INDEX ... USING btree (pr_id, ran_at DESC NULLS LAST)` via `pnpm db:generate`, even though no other schema file in this repo had a prior example of a descending index column to copy. _(2026-09-19)_

## Recurring Errors & Fixes

- **A seeded DB can be stale rather than wrong: `reviews.run_id` was null on PR #482 even though `seed.ts` already closes that link.** The symptom (timeline runs with no severity chips) looks like a client styling bug, and grepping the client for the join is a dead end — the fix loop has lived at `src/db/seed.ts:698` since `0d3ef61`, is deliberately idempotent, and rewrites `runId`/`agentId` unconditionally on every run. The database simply predated that commit and nobody re-ran `pnpm db:seed`. **Check whether the seed already handles it, and just re-seed, before adding code**: an inline `update` next to the runs insert looks right but is strictly worse — it sits inside the `if (!existingRun)` guard, so it is skipped on exactly the already-seeded databases that need repairing. Read `seed.ts` end to end first; it is ~750 lines and its cross-cutting passes live at the bottom, far from the inserts they repair. _(2026-09-20)_

- **`server/.env` in this worktree points `DATABASE_URL` at `devdigest_l01`, not the default `devdigest`, so a bare `psql -d devdigest` reads a different database than the API serves** — the default DB holds only PR #482's three runs, while `devdigest_l01` holds every seeded repo; auditing a data gap against the wrong one shows a tidy, complete picture and sends you after a bug that does not exist. Hit while checking `run_traces` coverage: `devdigest` looked fine, `devdigest_l01` had 3 of 7 runs with no trace. Read `DATABASE_URL` out of `server/.env` and pass it with `-d` before any `docker exec devdigest-postgres psql`. _(2026-09-20)_

- **`pnpm typecheck` in `server/` fails with `TS2307: Cannot find module 'openai'` / `'zod'` from `../reviewer-core/src/llm/*.ts` in a fresh worktree** — the server type-checks reviewer-core's raw source through the tsconfig path alias (`server/tsconfig.json` `paths`), so reviewer-core's own deps must be installed; fix: `cd reviewer-core && npm ci` (CI does the same step in `.github/workflows/server-unit.yml`). The follow-on `TS2322 'unknown' is not assignable to 'T'` errors in `src/adapters/llm/*.ts` are the same cause, not a real type bug. _(2026-09-28)_

- **Changing an exported TypeScript shape can leave `tsc --noEmit -p tsconfig.json` green while `server/test/**` breaks: the server tsconfig includes only `src/**/*.ts` (`server/tsconfig.json:28`), and vitest strips types without checking them** — changing `PromptParts.skills` from `string[]` to `SkillInput[]` broke `test/prompt-structured.test.ts` and `test/prompt-callers.test.ts` with no type error, only failing assertions (`### undefined`). After any contract change, run the full `vitest run`, or grep `test/` for the old shape; typecheck alone proves nothing about `test/`. `reviewer-core/tsconfig.json:28` has the same `src/**` include. _(2026-09-28)_

- **`arch:check` green locally but CI fails with `presentation-no-db: src/modules/*/routes.ts → node_modules/drizzle-orm/index.cjs` on already-baselined routes** — `.dependency-cruiser-known-violations.json` stores the *resolved* `to` path, so a baseline made on a pnpm `isolated` install (`node_modules/.pnpm/drizzle-orm@0.38.4_postgres@3.4.9/…`, check `nodeLinker` in `node_modules/.modules.yaml`; worktree installs can ignore `server/.npmrc` `node-linker=hoisted`) never matches CI's hoisted `node_modules/drizzle-orm/…`. Fixed with `preserveSymlinks: true` in `server/.dependency-cruiser.cjs:184` so paths are layout-independent; after any rule/option change regenerate with `pnpm arch:baseline`. _(2026-09-29)_

## Session Notes

### 2026-09-19 — Cost Badge (server) session
Implemented cost provenance persistence end to end: `agent_runs.cost_usd`/`cost_source` columns + `(pr_id, ran_at DESC)` index, contract fields on `RunStats`/`RunSummary`/`PrMeta` (`.nullish()` since `RunStats` is embedded in the `run_traces.trace` jsonb and old documents lack the keys entirely), adapter wiring (openai/anthropic/mocks through `pickCost`), run-executor persistence across the happy/fail-all/catch paths, a PR-list latest-run-cost lookup mirroring the existing `latestReviewByPr` pattern (`pulls/routes.ts`), and seed data covering all three UI states (provider / estimated / no-cost) on PR #482. Did not apply the generated migration to the shared dev Postgres container — see What Doesn't Work; validated instead via testcontainers-backed integration tests (7 files, 31 tests, all passing).

### 2026-09-20 — FINDINGS feature (server) session
`GET /repos/:id/pulls` now ships `last_review_findings`, aggregated with `GROUP BY review_id, severity` rather than by pulling finding rows — the route is polled every 60s and is unpaginated, so row-per-finding had no ceiling. Anchored on the same newest `kind:'review'` row as `score`, with `eq(reviews.workspaceId, …)` added for a direct tenancy scope and a separate guard for "PRs exist but none reviewed". Added `findings(review_id, severity)` and `reviews(pr_id, created_at DESC)` (migration `0011`), both previously missing entirely. The seed grew to four PRs covering every state the column can render — full tally, suggestion-only, and no review at all — plus a review→run→agent backfill pass. 24 files / 151 tests green including the testcontainers lane.

### 2026-09-20 — run_traces seed coverage (server) session
`run_traces` was seeded only for PR #482's two `done` runs, so every other seeded run opened an empty Agent-run drawer. Added a shared `traceFor(run, opts)` helper in `src/db/seed.ts`, gave the failed #482 run a trace whose log ends on a real `kind: 'error'` line, extended #479 / #477 / the xvivs fixture, and — the part that actually reaches an already-seeded database — a final unconditional backfill pass that LEFT JOINs `run_traces` and fills every `agent_runs` row still missing one. PR #482's two hand-written traces are untouched, so the cost/timeline e2e spec still sees `8.2s`, `15k→1.2k` and `$0.041`. Verified on the live dev DB: 3 of 7 runs lacked a trace before, 0 after. 24 files / 151 tests green.

### 2026-09-28 — server session
Renamed `server/CLAUDE.md` to `AGENTS.md` and added a one-line `@AGENTS.md` stub `CLAUDE.md` next to it, per ADR 0004. Edit rules in `AGENTS.md` only; the content itself did not change.

### 2026-09-28 — server session
Research-only session: surveyed server layering against Onion Architecture (5 parallel research subagents) and wrote the skill plan at `server/specs/onion-architecture-skill.md`. No code changed. Left: ADR 0005, the skill itself, `.dependency-cruiser.cjs` + `arch:check` with a baseline for the existing violations in `pulls`/`polling`/`settings`/`workspace`.

### 2026-09-28 — server session (onion-architecture skill)
Built the `onion-architecture` skill (`.claude/skills/onion-architecture/`: SKILL.md, 8 references, compiling module templates), ADR 0005 (proposed), `server/.dependency-cruiser.cjs` with 15 rules, `pnpm arch:check`/`arch:baseline` and a CI step in `server-unit.yml`. Every rule was proved against throwaway violating files. The 19 legacy violations are frozen in `.dependency-cruiser-known-violations.json`. Left: migrate `pulls`/`polling`/`settings`/`workspace` and the services that build their own repositories, and fix the non-atomic `deleteAgentRun`.

### 2026-09-28 — server session (SPEC-02 Skills)
Added the `skills` module (ports/wiring, first production `db.transaction`), transactional tenant-checked `PUT /agents/:id/skills` with a 24 KB budget, `skill_count`, and effective-skill resolution in `run-executor`. Review follow-ups bound vetting to the reviewed `version` (atomic UPDATE, Postgres-side sha256) and made the resolver require a matching `vetted_body_hash` for imports. 215 tests and arch:check green.

### 2026-09-29 — server session (skill versions, Phase 1)
`skill_versions` now snapshots name/description/type/body plus `change_note` (migration 0015 + `--custom` backfill 0016), `SkillsRepository.insert` writes v1 in a savepoint, and any content change bumps the version while `enabled` does not. Added `GET /skills/:id/versions`, `GET /skills/:id/versions/:version` and the version-guarded `POST …/restore` (409 `skill_version_stale`, 200 no-op, ADR 0012 limits re-checked, vetting via `resolveVettingOnBodyEdit`). Seeded skills get a v1 snapshot. 33 files / 269 tests green. Left: Phase 2 stats, Phase 3 evals.

## Open Questions

- **Stale entry: "no `.dependency-cruiser.*` config and no arch-check script" (Codebase Patterns, 2026-09-28) is no longer true** — `server/.dependency-cruiser.cjs` and `pnpm arch:check` now exist (`docs/adr/0005-onion-layering-for-server-modules.md`); the runtime-library half (`src/adapters/depgraph/index.ts:17`) still holds. Prune or rewrite the entry during cleanup. _(2026-09-28)_
