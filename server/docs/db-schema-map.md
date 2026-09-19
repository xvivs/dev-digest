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
| `repos` | 43 | imported repositories + clone path |
| `symbols` | 35 | repo-intel: extracted declarations |
| `agentRuns` | 27 | one row per agent execution |
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
| `workspaceMembers` | 1 | membership |

## Wired but unfed — a read path exists, nothing writes yet

These are **not** dead code. Removing them breaks compiling code.

| Table | Where it is wired | Fed by |
|---|---|---|
| `skills`, `agentSkills` | `modules/agents/repository.ts` reads, links and unlinks skills | L02 — there is no skills module to create them yet |
| `prIntent` | `modules/reviews/repository.ts` exposes `upsertIntent` / `getIntent` | L03 — nothing calls either yet |

## Unwired — zero references outside the schema

Lesson scaffolding. Empty by design.

```
skillVersions                      L02
conventions                        L02
codeChunks · memory                L05/L07 (memory + RAG, pgvector)
onboarding · prBrief               L05
evalCases · evalRuns               L06
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
