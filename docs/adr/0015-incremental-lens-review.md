# ADR 0015 — Lenses review only what changed since the last full PASS; cache keys are per lens

**Status:** accepted
**Date:** 2026-09-29
**Amends:** ADR 0014, "What this costs" (full-diff cost per PR)

## Context

ADR 0014 moved the LLM review from every push to `gh pr create`. On the L02
branch the next PR attempt still needed a full run over 517 files, and the
cache was empty for every lens. Two things caused that:

1. The branch had a full PASS at `3cf0018`. Five commits later only six code
   files had changed (`FindingCard`, `CommentCard`, `reviewer-core/src/prompt.ts`
   and their tests), but the stamp is keyed by the whole diff against
   `origin/main`, so the old PASS said nothing about the new diff.
2. The per-file cache key hashed the whole `references/lens-prompts.md`. Commit
   `1dc0392` changed two lines of the `core-purity` P4 row, which invalidated
   the cache of all six lenses, including `client-arch` and `server-tech`,
   whose instructions did not change.

ADR 0014 listed "review only the diff since the last PASS" as a rejected
alternative for pushes because it needs a stamp chain that survives rebases.
For the PR gate that trade-off looks different: a failed chain only falls back
to the full review, which is today's behaviour.

## Decision

1. **Incremental full run.** `collect` (without `--checks-only` or `--full`)
   looks for the nearest full PASS stamp with the same `base` and `branch`
   whose `head` is an ancestor of HEAD. If it finds one, lenses get only the
   files whose content differs between that `head` and HEAD
   (`git diff --name-only --no-renames`). The other files are recorded as
   `carried` and named in the report's "Пропущено" line and in `pr-body.md`.
2. The deterministic checks (typecheck, unit tests, `arch:check`, static
   rules) still run on the whole branch diff. The stamp is still keyed by the
   whole diff's `diffHash`, so the hook does not change.
3. The stamp records `incrementalFrom: { diffHash, head }`. An incremental PASS
   is a full PASS and can itself be the base for the next run.
4. `--no-incremental` forces the full review. `--full` also disables it: it
   asks for more coverage (advisory lenses), not less.
5. **Per-lens cache key.** `lensRulesHash` hashes the shared parts of
   `lens-prompts.md` (lens contract, skeptic prompt) plus only that lens's own
   `### ` block. Skill `SKILL.md`, package `AGENTS.md` and `INSIGHTS.md` stay in
   the key as before.

## Consequences

### What this enables

- The PR run on L02 goes from 517 files and 6 lenses to 6 files and 4 lenses.
- Editing one lens's block in `lens-prompts.md` re-reviews only that lens.

### What this costs

- A file carried from an earlier PASS is not re-read when a file it depends on
  changes. A broken contract between a changed file and an unchanged caller is
  caught only by typecheck and tests, not by a lens.
- Carried files are not re-reviewed under rules added after their PASS (a new
  skill rule or a new lens block). Run `--no-incremental` after changing a
  skill when the whole branch should meet the new rule.
- A rebase or amend breaks the ancestry chain and the next run is full again.
- Stamps live in the gitignored `.devdigest/self-review/`. The gate already
  trusts that directory; the incremental base trusts it the same way.

### What this forbids

- Using a `checks`-level or BLOCK stamp as an incremental base.
- Using a stamp from another branch or another base, even if its head is an
  ancestor.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Keep the full review per PR (ADR 0014 as is) | Every file reviewed under current rules | ~1M tokens and tens of minutes per run on a large branch, even when six files changed |
| **Incremental from the nearest full PASS + per-lens cache key (chosen)** | Cost scales with what changed; a failed chain falls back to full | Cross-file regressions in carried files rely on checks; old files are not held to new rules |
| Base on content equality with any stamp, no ancestry check | Survives rebases | A file can match content reviewed in a different context (other branch, other imports) |
| Let `gh pr create` through on an ancestor's full PASS if the delta passes checks | Zero tokens | The delta gets no LLM review at all; on L02 that delta was the prompt-injection code in `prompt.ts` |
| Checks-only gate for PRs too | Simplest | Drops the LLM gate that ADR 0006 exists for |

## Revisit when

- A regression reaches a PR through a carried file whose dependency changed.
  Then extend the delta with direct importers of changed files.
- Lens output becomes stable enough that a full re-run is cheap confirmation.
