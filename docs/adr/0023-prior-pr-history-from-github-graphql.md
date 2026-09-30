# ADR 0023 — Prior-PR history from GitHub GraphQL path history

**Status:** accepted
**Date:** 2026-09-30
**Relates to:** [specs/04-pr-overview.md](../../specs/04-pr-overview.md) (decision D11, "Prior PRs (server)")

The code for this ADR is not written yet. It records the decision in the spec.

## Context

The Overview tab lists earlier merged PRs that touched the same files. The data is not local:

- `pr_files` exists only for PRs whose detail was opened, and `merged_at` is not stored.
- The synced window is the 50 most recently updated PRs, so older history is missing.
- The managed clone is shallow, so `git log -- path` cannot see deep history. It also yields commits, not PR numbers.

The codebase uses only the GitHub REST API through `octokit`. This is its first GraphQL call. It is a new external-API pattern with its own rate budget (5 000 points per hour, separate from REST).

## Decision

1. **One GraphQL query per cache miss.** `GitHubClient.listPathHistory` sends one `octokit.graphql` request with one alias per path: `history(path:, first:N)` on the base-branch commit, selecting `associatedPullRequests(first: 1) { number title mergedAt author }`. It goes through the same retry and timeout wrappers as the other GitHub methods.
2. **Bounded query.** At most 10 changed files (highest churn first), 10 commits per path, 10 items returned.
3. **Domain filtering.** `associatedPullRequests` can return open PRs, so rows with `mergedAt` null are dropped. The PR itself is excluded. Rows are grouped by PR number into `files_overlap` and sorted by `merged_at` descending.
4. **Fallback.** Aliased `history` fields are valid GraphQL but untested here. If the aliased form errors, the adapter issues one query per path. The spec requires a unit test and a manual check against a real public repo before merge.
5. **Cached, not computed at import.** The result is cached in `pr_history_cache`, keyed by PR, `head_sha`, base branch and a hash of the queried paths, with a 6 hour TTL. It is a lazy GET, so there is no import-time cost.
6. **Deterministic notes.** `notes` is an empty string, and the UI renders the overlap list. LLM-written relevance notes are deferred (spec OQ-8).
7. **Degrades to unavailable.** No token gives `unavailable/no_github`. A GraphQL error, such as a deleted base branch, gives `fetch_failed`, which is not cached.

## Consequences

### What this enables

- Full remote history on a shallow clone, with real PR numbers and `mergedAt` from the API.
- About 1 GraphQL point per cache miss, and one request per Overview open at most.

### What this costs

- Needs a GitHub token. Without one the block shows `unavailable`.
- A second GitHub API surface with its own rate budget and error shape to retry and test.
- Aliasing is unverified until the step-10 test and manual check pass.
- A path renamed on the base branch loses its pre-rename history, because `history(path:)` follows one path.
- Results can be up to 6 hours old.

### What this forbids

- Deriving prior PRs from local `git log` or commit-message parsing.
- Calling this query at import time.
- Writing LLM-generated text into `notes` without a new decision.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| **GraphQL aliased `history` (chosen)** | Full remote history; independent of the clone; one request | Needs a token; first GraphQL use; aliasing untested here |
| REST `GET /commits?path=` plus `GET /commits/{sha}/pulls` | Simple, same API as today | About 60-100 requests per PR; burst and secondary limits |
| Store `merged_at`, backfill `pr_files` for merged PRs, query locally | Offline reads | Covers only the synced window; `PrMeta` contract change; backfill job |
| Deepen the clone and run `git log -- path` | Local | PR numbers only by unreliable squash and merge message parsing; races `sync` and the indexer's fetch policy |
| Search API | None | No path qualifier; 30 requests per minute |
