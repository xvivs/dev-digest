# repo-intel — the codebase indexer

Indexes a cloned repo once (incrementally on fetch) into symbols, an import
graph, a PageRank file score, and a cached repo map. Reviews only **read** it.

## Rules

- Consume through the `RepoIntel` facade (`service.ts`, interface in `types.ts`),
  resolved as `container.repoIntel`. Never import `@ast-grep/napi`,
  `dependency-cruiser`, `graphology` or the tokenizer from a feature module.
- Degrade, never throw. Array-returning methods return `[]` when degraded;
  object-returning methods carry `degraded` + a reason. `getIndexState()` always
  works and is the one place the real status is observable.
- Bump `INDEXER_VERSION` in `constants.ts` whenever the AST extractor or the
  symbol schema changes. A version mismatch is what forces a full reindex —
  without the bump, stale indexes are silently kept.
- Clamp indexed identifiers with `clampIndexedName` before insert. Postgres
  rejects btree rows over ~2704 bytes, and a bad parse can capture a multi-KB
  "identifier" that crashes the whole indexer.
- Indexing runs as a `JobRunner` job, not inline in a request. Its soft budget
  (`INDEX_SOFT_BUDGET_MS`) sits below the runner's hard 120s timeout so an
  over-running index finishes as `partial` instead of being killed.
- Limits live in `constants.ts` (`MAX_INDEXED_FILES`, `MAX_FILE_SIZE`,
  `SUPPORTED_EXT`, `EXCLUDED_DIRS`). Change them there, not at call sites.

## Gotchas

- `REPO_INTEL_ENABLED` (global) and the per-agent `repo_intel` flag are two
  separate gates. Both must be on for a review to get enrichment.
- An unindexed repo degrades **silently**: the prompt simply loses its repo-map
  and callers sections. Empty enrichment is not an error signal — check
  `getIndexState()`.
- `T1`/`T2`/`T3` tags throughout are build-phase markers from the original
  rollout, all shipped. They carry no runtime meaning.

## Read when

- Read `README.md` for the pipeline diagram and the full facade surface.
- Read `types.ts` before adding a facade method — the degraded contract is
  documented at the top.
- Read `INSIGHTS.md` before starting work here and note which entries are
  relevant — treat it as high-confidence guidance unless this file says
  otherwise.

## Before you finish

Update `INSIGHTS.md` with anything durable you learned this session — don't
skip this step.
