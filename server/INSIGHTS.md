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

## What Doesn't Work

- **Running `pnpm db:migrate` against the shared `devdigest-postgres` docker container can fail with "column already exists"** — every worktree/branch on this course points at the SAME long-lived container (`docker ps` shows one `devdigest-postgres` regardless of branch), so its `__drizzle_migrations` history can be far ahead of this branch's local `src/db/migrations/*.sql` (e.g. `agent_runs.cost_usd` already existed there from another lesson's branch, but without `cost_source`). Check first with `docker exec devdigest-postgres psql -U devdigest -d devdigest -c '\d <table>'`; validate a new migration via the testcontainers-backed `*.it.test.ts` suite (fresh throwaway Postgres per run, `test/helpers/pg.ts`) instead of assuming the shared dev DB is safe to ALTER. _(2026-09-19)_

- **Guarding a seed backfill with `isNull(<column>)` strands every column added to that backfill later** — the review→run pass in `src/db/seed.ts` used `WHERE run_id IS NULL`, which passes once and blocks forever after. Adding `agentId` alongside `runId` then did nothing on any already-seeded database, and the Review-runs card kept rendering the literal "Agent" while the timeline row right above it named the reviewer. Values re-derived from a deterministic lookup should be rewritten unconditionally — the UPDATE is a no-op when they already match. _(2026-09-20)_

## Codebase Patterns

- **Seed rows created inside one `if (!row)` guard are invisible to the next guard, so cross-entity links need their own idempotent pass** — `src/db/seed.ts` creates each review inside `if (!pr) { … }` and the runs inside `if (!existingRun) { … }`, so neither block can see the other's `.returning()` value, and `runs[0].id` does not compile under `noUncheckedIndexedAccess` anyway. Pattern that works: a separate loop after both blocks that re-selects the newest `status='done'` run per PR and updates `reviews` from it. Do NOT guard that update with `WHERE run_id IS NULL` — the pass carries `agent_id` too, and an `isNull` guard on one column silently strands every column added to the pass later (see What Doesn't Work). Re-deriving from a deterministic lookup makes the UPDATE a no-op when the values already match, so it stays idempotent without a guard. _(2026-09-20)_

- **Seeded run counters are copied into `run_traces`, so they must be edited in the `.values([...])` literal, not by a follow-up UPDATE** — `seed.ts` builds `trace.stats.findings` from `.returning()` on the `agent_runs` insert. An UPDATE after the fact fixes the row but leaves the trace document behind, and the run drawer then shows a different finding count than the list. _(2026-09-20)_

## Tool & Library Notes

- **`pnpm exec <bin>` / `pnpm run <script>` can fail non-interactively with `ERR_PNPM_IGNORED_BUILDS` even when `node_modules` is already correct** — both `pnpm db:generate` and `pnpm exec drizzle-kit generate` refused to run this way, erroring "Run \"pnpm approve-builds\" to pick which dependencies should be allowed to run scripts." Workaround: invoke the wrapper under `node_modules/.bin/` directly with `sh`, e.g. `sh node_modules/.bin/drizzle-kit generate`, `sh node_modules/.bin/tsx src/db/migrate.ts`, `sh node_modules/.bin/vitest run` — bypasses pnpm's pre-flight check entirely. _(2026-09-19)_

- **A `.desc()` index column is documentation, not speed — but a composite covering index for a `GROUP BY` is real, and it degrades under row churn** — measured on a throwaway pg16 (202k `reviews`, 24k `findings`) against the exact `GET /repos/:id/pulls` queries. (1) `reviews(pr_id, created_at DESC)` benchmarks identically to `(pr_id, created_at)` ascending — PG reads the ascending index backwards (`Index Scan Backward`), 0.025 ms either way. And on the list query itself the `created_at` column earns nothing at all: PG16 cannot return ordered rows through a ScalarArrayOp (`pr_id IN (…)`) scan, so all of `(pr_id)`, `(pr_id, created_at)` and `(pr_id, created_at DESC)` produce the same Bitmap scan + Sort at 0.15 ms. The column pays off only on the single-PR path (`pr_id = ?`), where it drops the Sort. (2) `findings(review_id, severity)` genuinely beats `(review_id)` on `GROUP BY review_id, severity`: 0.158 ms (index-only scan + GroupAggregate, 0 heap fetches) vs 0.343 ms (bitmap heap scan + HashAggregate), for 448 kB vs 240 kB. But accept/dismiss writes stale the visibility map, and the plan then drops to a bitmap heap scan at 0.29 ms — the single-column index's number. Floor equals `(review_id)`, ceiling is ~2x, autovacuum decides which you get. (3) The bigger, unasked-for win: neither `findings.review_id` nor `reviews.pr_id` had an index at all, and PG never auto-indexes FK columns — cascade-deleting 20 reviews spent 13.8 ms in `findings_review_id_fkey` before, 0.6 ms after. _(2026-09-20)_

- **drizzle-orm 0.38.x pg-core index columns take `.desc()`/`.asc()` directly inside `.on(...)`** — `index('agent_runs_pr_ran_at_idx').on(t.prId, t.ranAt.desc())` (`server/src/db/schema/runs.ts`) generated `CREATE INDEX ... USING btree (pr_id, ran_at DESC NULLS LAST)` via `pnpm db:generate`, even though no other schema file in this repo had a prior example of a descending index column to copy. _(2026-09-19)_

## Recurring Errors & Fixes

- **A seeded DB can be stale rather than wrong: `reviews.run_id` was null on PR #482 even though `seed.ts` already closes that link.** The symptom (timeline runs with no severity chips) looks like a client styling bug, and grepping the client for the join is a dead end — the fix loop has lived at `src/db/seed.ts:698` since `0d3ef61`, is deliberately idempotent, and rewrites `runId`/`agentId` unconditionally on every run. The database simply predated that commit and nobody re-ran `pnpm db:seed`. **Check whether the seed already handles it, and just re-seed, before adding code**: an inline `update` next to the runs insert looks right but is strictly worse — it sits inside the `if (!existingRun)` guard, so it is skipped on exactly the already-seeded databases that need repairing. Read `seed.ts` end to end first; it is ~750 lines and its cross-cutting passes live at the bottom, far from the inserts they repair. _(2026-09-20)_

- **`server/.env` in this worktree points `DATABASE_URL` at `devdigest_l01`, not the default `devdigest`, so a bare `psql -d devdigest` reads a different database than the API serves** — the default DB holds only PR #482's three runs, while `devdigest_l01` holds every seeded repo; auditing a data gap against the wrong one shows a tidy, complete picture and sends you after a bug that does not exist. Hit while checking `run_traces` coverage: `devdigest` looked fine, `devdigest_l01` had 3 of 7 runs with no trace. Read `DATABASE_URL` out of `server/.env` and pass it with `-d` before any `docker exec devdigest-postgres psql`. _(2026-09-20)_

## Session Notes

### 2026-09-19 — Cost Badge (server) session
Implemented cost provenance persistence end to end: `agent_runs.cost_usd`/`cost_source` columns + `(pr_id, ran_at DESC)` index, contract fields on `RunStats`/`RunSummary`/`PrMeta` (`.nullish()` since `RunStats` is embedded in the `run_traces.trace` jsonb and old documents lack the keys entirely), adapter wiring (openai/anthropic/mocks through `pickCost`), run-executor persistence across the happy/fail-all/catch paths, a PR-list latest-run-cost lookup mirroring the existing `latestReviewByPr` pattern (`pulls/routes.ts`), and seed data covering all three UI states (provider / estimated / no-cost) on PR #482. Did not apply the generated migration to the shared dev Postgres container — see What Doesn't Work; validated instead via testcontainers-backed integration tests (7 files, 31 tests, all passing).

### 2026-09-20 — FINDINGS feature (server) session
`GET /repos/:id/pulls` now ships `last_review_findings`, aggregated with `GROUP BY review_id, severity` rather than by pulling finding rows — the route is polled every 60s and is unpaginated, so row-per-finding had no ceiling. Anchored on the same newest `kind:'review'` row as `score`, with `eq(reviews.workspaceId, …)` added for a direct tenancy scope and a separate guard for "PRs exist but none reviewed". Added `findings(review_id, severity)` and `reviews(pr_id, created_at DESC)` (migration `0011`), both previously missing entirely. The seed grew to four PRs covering every state the column can render — full tally, suggestion-only, and no review at all — plus a review→run→agent backfill pass. 24 files / 151 tests green including the testcontainers lane.

### 2026-09-20 — run_traces seed coverage (server) session
`run_traces` was seeded only for PR #482's two `done` runs, so every other seeded run opened an empty Agent-run drawer. Added a shared `traceFor(run, opts)` helper in `src/db/seed.ts`, gave the failed #482 run a trace whose log ends on a real `kind: 'error'` line, extended #479 / #477 / the xvivs fixture, and — the part that actually reaches an already-seeded database — a final unconditional backfill pass that LEFT JOINs `run_traces` and fills every `agent_runs` row still missing one. PR #482's two hand-written traces are untouched, so the cost/timeline e2e spec still sees `8.2s`, `15k→1.2k` and `$0.041`. Verified on the live dev DB: 3 of 7 runs lacked a trace before, 0 after. 24 files / 151 tests green.

## Open Questions

