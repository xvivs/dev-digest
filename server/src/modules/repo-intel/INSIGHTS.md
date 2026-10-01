# INSIGHTS — repo-intel

Append-only journal of things that cost us time in the indexer. Write here
**first** and without a filter: an entry is cheap, a line in `CLAUDE.md` is
not.

This subsystem degrades silently by design, so entries about *missing* output
matter as much as entries about crashes — an empty result is not
self-explaining.

Server-wide findings go in `../../../INSIGHTS.md` (`server/INSIGHTS.md`).

Priority: silent degradation — an empty or degraded result without an error
deserves an entry, not just crashes.

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly cleanup —
lives in the engineering-insights skill).

## What Works

## What Doesn't Work

## Codebase Patterns

- **`RepoIntelService` and `RepoService` must exist once per Container; a second `new RepoIntelService(container)` silently gets its own index gate and breaks dedupe.** The routes used to build their own instance next to the lazy facade, which forced per-repo state into `WeakMap<Container, …>`; spec server/07 moved both onto `container.repoIntelService` / `container.repoService` (`server/src/platform/container.ts:206,243`, `@internal`, used only by their routes) with the gate and clone failures as private fields. Facades `repoIntel` / `repoClone` return the override when a test sets one, else that same instance, so job handlers always register on the real service. _(2026-10-01)_

- **Re-running resync/refresh never repairs a `partial` index at the same HEAD; only `indexRepo` (unconditional `runFullIndex`) does, and even that usually ends `partial` again.** `runIncremental` never reads `state.status`: on an unchanged sha it touches `updated_at` and returns `sha_unchanged` with the old status (`pipeline/incremental.ts:97-105`), and `runFullIndex` returns `partial` deterministically on any parse error, graph failure, soft budget or `no_files` (`pipeline/full.ts:101-105,250-253`). Hence spec 06 makes it the explicit `reindex_partial` action, never automatic. `updated_at` is also not a "last indexed" time — use `last_indexed_at`. _(2026-10-01)_

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

### 2026-09-28 — repo-intel session
Renamed `server/src/modules/repo-intel/CLAUDE.md` to `AGENTS.md` and added a one-line `@AGENTS.md` stub `CLAUDE.md` next to it, per ADR 0004. Edit rules in `AGENTS.md` only; the content itself did not change.

### 2026-10-01 — repo-intel session
All three index enqueue paths (INDEX / REFRESH / RESYNC) now go through `requestIndex` and a per-repo `KeyedGate` held as a private field of the container's single `RepoIntelService` (spec server/07); trailing passes run as their own jobs. `repo_index_state.last_indexed_at` (migration 0028) is written only by real full/incremental runs, and Refresh repo on an existing clone now runs one incremental via the clone follow-up (PC-9, F6).

## Open Questions
