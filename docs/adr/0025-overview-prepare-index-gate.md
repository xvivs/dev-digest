# ADR 0025 — Overview prepare: server-planned orchestration, per-repo in-process index gate, `last_indexed_at`

**Status:** accepted; amended 2026-10-01 by [server/specs/07-refactor-single-repo-service-instances.md](../../server/specs/07-refactor-single-repo-service-instances.md) (one service instance per container)
**Date:** 2026-10-01
**Relates to:** ADR 0020 (single API instance), ADR 0022 (derived PR brief); [specs/06-overview-prepare.md](../../specs/06-overview-prepare.md), decisions D3-D5, D7, D7a, D13a, D16

## Context

The Overview needs a clone, an index and a brief before it is useful. Three screens started those steps on their own. Nothing deduped them: `JobRunner.enqueue` always inserts a row and schedules it, and a timeout frees the runner slot while the handler keeps running. Two full indexes of one repo could interleave their non-atomic delete-and-insert (`deleteAllForRepo` in `pipeline/full.ts`).

The UI also could not tell how old an index was. `repo_index_state.updated_at` moves on every no-op touch, so it says nothing about when the clone was last read.

`RepoIntelService` and `RepoService` were each constructed twice per app (routes plugin and container getter). The refactor in spec server/07 left one instance of each per `Container`, so state kept on an instance is shared by the job handlers and the facade.

## Decision

1. **A server module `overview` plans the work.** `GET /pulls/:id/overview/readiness` returns `PrOverviewReadiness`; `POST /pulls/:id/overview/prepare` returns 202 and runs exactly the plan readiness reported. The plan is the pure `planPrepare` in `server/src/modules/overview/domain.ts`. The service reads facts through the container's facades (`repoClone`, `repoIntel`, brief) and never imports another module.

2. **`KeyedGate` in `server/src/platform/keyed-gate.ts`.** One instance per concern, held as a private field of the service that owns it: `indexGate` on `RepoIntelService`, `cloneGate` on `RepoService`. The container holds exactly one instance of each (`container.repoIntelService`, `container.repoService`, `@internal`, for their own routes); `container.repoIntel` / `container.repoClone` return a test override or that instance. Job handlers register on the concrete instance, so a facade override never takes the handlers with it. Separate test apps get separate containers and so separate gates.
   - `reserve(key)` is synchronous. Two callers in one tick cannot both pass. The caller releases the reservation when `job.done` settles or when `enqueue` throws.
   - `runExclusive(key, …)` wraps the handler body. The key stays busy until the body, and any trailing passes, end. The lock does not hang off `JobRunner`'s `done`, which a timeout settles early while the handler keeps running.
   - A request or handler that arrives while the repo is busy is merged into one trailing pass (OR of full index and resync). When the repo goes idle, the gate keeps it reserved and enqueues the pass as a new job with its own timeout (`dispatchTrailing` in `repo-intel/service.ts`).

3. **All index enqueues go through the gate.** `repoIntel.requestIndex(workspaceId, repoId, 'index' | 'refresh' | 'resync')` is the only caller of `jobs.enqueue` for the `INDEX`, `REFRESH` and `RESYNC` kinds. Its callers are the clone job's follow-up in `repos/service.ts` (`RepoService.refresh` only enqueues a clone; the follow-up requests the index), the `resync` route in `repo-intel/routes.ts`, and the overview service's `index_full`, `index_incremental` and `reindex_partial` actions. The three job handlers run under `runGated`. Clone jobs have their own gate (`enqueueClone`, with `runExclusive` in the handler); the clone job requests its index follow-up before its own gate frees, so readiness never sees "cloned, nothing in flight".

4. **`repo_index_state.last_indexed_at`** (migration `0028_funny_sentry.sql`). It is set by full and incremental runs that read the clone and by `advanceSha`. It is not set by a `sha_unchanged` touch or a `no_clone` stamp. Rows written before the column keep `null`; there is no backfill.

5. **`partial` at the clone HEAD is an explicit action.** A full re-run there would end `partial` again, so `planPrepare` no longer queues it. When an incremental run keeps `partial`, it copies `partialReason` into `stats` so readiness still reports why (`pipeline/incremental.ts`). `planExplicit` offers `reindex_partial` instead, and `POST /prepare` runs it only when the body has `reindex_partial: true` and the action is offered.

6. **Client auto-continuation.** After the user clicks Prepare, `PrepareOverview` keeps an intent in a ref. `usePrOverviewReadiness` calls `onReadiness` from its `queryFn` after each poll, and the callback fires `POST /prepare` again while the plan still has automatic actions. Each action is fired at most once per click, and the intent ends on completion, error, a failed action or unmount. Firing a mutation from a `queryFn` callback is a deliberate exception to react-best-practices "mutations are triggered from event handlers": the trigger is the poll result, an external event, not a render.

7. **Clone failures are kept in memory.** `RepoService` stores the last failure per repo as a class (`CloneFailureReason`) and a timestamp, in the `cloneFailures` field of the container's single `RepoService`. The raw error is dropped because it can carry the clone URL or the token. Readiness reports it as `clone.last_failure`.

## Consequences

### What this enables

- One-click preparation. The plan is computed in one place and shown by `GET` and executed by `POST`.
- Dedupe across every index trigger, and no overlapping index pipelines for one repo, including after a `JobRunner` timeout.
- Readiness gets `isBusy` from the gate without another query.
- An honest "last indexed" time. A null renders as "unknown".

### What this costs

- **Refresh repo changes behaviour.** The clone job now requests `'refresh'` when the repo already has a clone path and `'index'` only after a fresh clone (`before.clonePath === null`, `runCloneJob`). A Refresh repo click on an existing clone used to enqueue a full index each time; it now runs an incremental refresh. Spec 06 records this as PC-9.
- **Single API instance (ADR 0020).** The gates and `cloneFailures` are in memory. A restart drops them; a second process (script, replica) gets its own gate and can overlap. After a restart readiness stops explaining a past clone failure.
- Each pass is its own job; only a single body over 120 s outlives its job row.
- Pre-migration rows show no index time.
- **Rate limit.** `POST /prepare` is limited to 5 per minute (`PREPARE_RATE_LIMIT` in `overview/constants.ts`), as one call can start two LLM requests. Readiness has its own bucket of 120 per minute for polling. An auto-continuation that would exceed 5 per minute receives a 429 and stops, as an error ends the intent.
- A `partial` index at the clone HEAD is no longer retried automatically; the user presses "Update index".

### What this forbids

- Enqueueing `INDEX`, `REFRESH` or `RESYNC` jobs on `container.jobs` directly (`server/src/modules/repo-intel/AGENTS.md`).
- Writing `last_indexed_at` from a touch.
- Releasing the gate from `job.done` alone for handler work: the lock belongs to the handler body.
- Constructing `RepoIntelService` or `RepoService` outside `platform/container.ts`. A second instance would get its own gates and clone failures.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Client assembles readiness from `/intent`, `/risks`, `/index-state`, `/repos` and fires the existing actions | No new module | Plan logic duplicated in the client; racy without server dedupe; several round-trips per poll; `head_moved` and flag rules leak into the UI |
| Prepare inside the `brief` module | One fewer module | `brief` would orchestrate clone and index, coupling an LLM module to the indexer; `brief/service.ts` is already large |
| Partial unique index on `jobs (kind, payload->>'repoId') WHERE status IN ('queued','running')` | Survives several processes | `jobs` rows are not reaped on boot, so a crash would block the key forever; a timed-out job is `failed` while its handler still runs, so the index misses that overlap; needs a migration and unique-violation handling in `JobRunner` |
| Postgres advisory lock `pg_try_advisory_lock(hashtext(repoId))` around the handler | Works across processes | Session-scoped: holds a dedicated pool connection for up to the 120 s timeout; does not dedupe at enqueue time; readiness needs another query to see "busy" |
| **In-process `KeyedGate` per service instance, one instance per container (chosen)** | No schema change; covers the timeout overlap; free `isBusy` | One process only; state lost on restart |
| Module-scope `WeakMap<Container, KeyedGate>` (original choice) | Works with two instances per app | Hides the duplicate instances; any new per-repo field splits silently |
