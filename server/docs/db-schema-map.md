# Database schema map

The schema in `src/db/schema/` is **complete for the whole course**, not for the
starter. Most tables exist, have migrations, and are never written to. That is
deliberate: each lesson fills its own tables without a schema migration of its
own.

This document exists so nobody "cleans up" a table that a later lesson needs, and
so nobody wonders why a query returns nothing.

Counts below are references to a table outside `src/db/schema*`, measured by
grepping for `t.<table>` / `schema.<table>`.

## Live — written and read by the starter

| Table | Refs | Role |
|---|---|---|
| `skills` | 48 | skill bodies + ADR 0012 vetting state (`modules/skills`) |
| `repos` | 43 | imported repositories + clone path |
| `symbols` | 35 | repo-intel: extracted declarations |
| `agentRuns` | 27 | one row per agent execution |
| `skillVersions` | 25 | append-only snapshot of every skill field per version (ADR 0016) |
| `pullRequests` | 24 | imported PRs (unique on `repo_id`+`number`) |
| `agents` | 20 | reviewer agent configs |
| `references` | 18 | repo-intel: symbol usages |
| `fileRank` | 17 | repo-intel: PageRank + git hotness |
| `reviews` | 17 | one row per produced review |
| `jobs` | 12 | JobRunner mirror |
| `agentSkills` | 11 | agent ↔ skill link table |
| `fileFacts` | 10 | repo-intel: precomputed per-file facts |
| `settings` | 10 | non-secret workspace prefs |
| `findings` | 9 | grounded findings of a review |
| `repoIndexState` | 8 | drives the **Indexed** badge |
| `repoMapCache` | 8 | cached repo skeleton |
| `prFiles` | 7 | per-file diff metadata |
| `agentVersions` | 7 | immutable agent config snapshots |
| `workspaces` | 5 | tenancy root |
| `fileEdges` | 5 | repo-intel: import graph |
| `users` | 4 | seeded system user |
| `prCommits` | 4 | commits behind a PR |
| `runTraces` | 3 | whole run log as one jsonb document |
| `runSkills` | 4 | skills each run injected (relational copy of `skills_used`), feeds skill Stats |
| `workspaceMembers` | 1 | membership |
| `evalSuites` | 72 | one ablation eval of a skill on a carrier agent: frozen prompt, estimate, `done_jobs` counter, results (ADR 0017/0018, `modules/evals`) |
| `evalRuns` | 45 | one job per (case, arm, repeat), UNIQUE on that key; the legacy L06 metric columns (`precision`) stay, deprecated |
| `evalCases` | 26 | skill eval cases: diff snapshot + `EvalExpectation`; `skill_id` FK set iff `owner_kind='skill'` |

## Wired but unfed — a read path exists, nothing writes yet

These are **not** dead code. Removing them breaks compiling code.

| Table | Where it is wired | Fed by |
|---|---|---|
| `prIntent` | `modules/reviews/repository.ts` exposes `upsertIntent` / `getIntent` | L03 — nothing calls either yet |

## Unwired — zero references outside the schema

Lesson scaffolding. Empty by design.

```
conventions                        L02
codeChunks · memory                L05/L07 (memory + RAG, pgvector)
onboarding · prBrief               L05
conformanceChecks                  L06
ciInstallations · ciRuns           L06
multiAgentRuns · composedReviews   L07
installedPlugins · digests         L08
```

## Rules

- Every domain table carries `workspace_id` (FK → `workspaces`) and, where
  relevant, `created_by`. All queries scope by workspace — obtained via
  `getContext(container, req)`, never hardcoded.
- Migrations live in `src/db/migrations/` and are generated: `pnpm db:generate`.
  Never hand-edit a generated SQL file or the journal.
- Migrations are **not** applied on boot. `relation ... does not exist` means
  `pnpm db:migrate` was skipped. pgvector is enabled by migration `0000`.
- A data backfill is its own migration: `drizzle-kit generate --custom --name <slug>`
  creates an empty file, the DML goes in it (e.g. `0016_skill_versions_backfill.sql`
  snapshots each skill's current state). Write it idempotent (`ON CONFLICT DO
  NOTHING`, `WHERE … IS NULL`) and cover it with an `*.it.test.ts`.
- A backfill that must run BETWEEN two schema steps is a sandwich of three
  migrations: generate the column, `--custom` the DML, then generate the
  constraint. `0018` adds `eval_cases.skill_id`, `0019` deletes orphans and
  backfills it, `0020` adds the FK + CHECK (test: `test/evals-migrations.it.test.ts`).
- One running eval suite per workspace is a partial unique index
  (`eval_suites_one_running_per_workspace_uq`), so two concurrent starts cannot
  both win; `eval_suites.carrier_agent_id` has no FK on purpose, so the verdict
  history survives a deleted agent.
- A backfill over a table that grows with usage (e.g. `run_traces`) is a
  batched script instead, so it never holds one long migration transaction:
  `pnpm db:backfill:run-skills [--after=<run_id>] [--batch=<n>]` copies
  `skills_used` into `run_skills`, logs a resume cursor per batch and is safe
  to re-run.
- `pnpm db:seed` is idempotent and **required**, not optional: `LocalNoAuthProvider`
  resolves the seeded system user and default workspace by name and throws
  without them. The seed also creates the demo repo, PR #482, and three built-in
  agents on `openrouter` / `deepseek-v4-flash`.
- Indexed identifier columns (`symbols.name`, `references.to_symbol`) must pass
  through `clampIndexedName` (255 chars). Postgres rejects btree rows above
  ~2704 bytes, and a bad parse can produce a multi-KB "identifier".

## Adding a table

The schema is already complete for L01–L08. If you genuinely need a new table:
add it to the right domain file under `src/db/schema/`, re-export from the
`db/schema.ts` barrel, then `pnpm db:generate` and `pnpm db:migrate`. Include
`workspace_id` unless there is a stated reason not to.
