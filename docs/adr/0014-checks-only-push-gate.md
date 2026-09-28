# ADR 0014 — Push needs the deterministic checks; the LLM review gates the PR

**Status:** accepted
**Date:** 2026-09-29
**Amends:** ADR 0006, Decisions 3 and 5 · amended by [ADR 0015](0015-incremental-lens-review.md)

## Context

ADR 0006 lets `git push` and `gh pr create` through only with a PASS stamp from
the full `pr-self-review`: deterministic checks plus one LLM lens per skill
group. On the L02 branch (2026-09-28/29) that meant six full or partial runs
before one push landed, over 4M subagent tokens and several hours of waiting.
Three things drove the cost:

1. The diff is always taken against `origin/main`, so every run reviews the
   whole branch (512 files here), not what changed since the last push.
2. Editing `references/lens-prompts.md` invalidates every cached lens result,
   which forced two full runs of about 1M tokens each.
3. Lenses are not deterministic. The same unchanged files produced 3, then 17,
   then 0 client-arch findings across runs, so each re-run created new work
   instead of confirming the previous fixes.

Only the first cause depends on when the review runs, but running it on every
push multiplies the other two. What must not reach the remote is narrower than
what the lenses look for: code that does not compile, failing tests, layering
violations, secrets, hand-edited migrations. Those are all deterministic
checks that take minutes and no tokens.

## Decision

1. `pr-self-review --checks-only` runs `collect` and `check` and skips the LLM
   lenses and the skeptic. Its stamp records `"level": "checks"`; a full run
   records `"level": "full"`.
2. The `PreToolUse` hook lets `git push` through with a PASS stamp of either
   level, and `gh pr create` only with a `full` PASS. A stamp without `level`
   predates this ADR, came from a full run, and counts as `full`.
3. A checks-only run never replaces an existing `full` PASS for the same diff
   and never writes the per-file lens cache or `refuted.jsonl`.
4. Everything else in ADR 0006 stands: one CRITICAL blocks with no waiver, the
   verdict is computed by the script, a clean tree is required, and a failed
   check or lens means BLOCK. Decision 5 ("no deterministic-only mode") is
   replaced by Decision 1 above for pushes only.

## Consequences

### What this enables

- A push costs a few minutes of typecheck, tests and static rules, and no
  tokens. Code that does not build still cannot reach the remote.
- The LLM review runs once per PR over the final diff, so its findings are
  about the code that will actually be reviewed by a human.

### What this costs

- Pushed commits can carry problems only a lens would catch (layer leaks the
  linter cannot see, weak tests, injection paths) until the PR is opened.
- Findings arrive in one batch before the PR instead of spread over pushes.
  A large branch still pays the full-diff cost once; see "Revisit when".
- Every push to an open PR is no longer LLM-reviewed. The next `gh pr create`
  does not happen for an existing PR, so a follow-up push relies on the checks
  and on human review.

### What this forbids

- Opening a PR with only a checks-level stamp.
- Treating a checks-level PASS as a review: the report says the lenses were
  skipped.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Keep the full gate on push (ADR 0006 as is) | Every pushed commit is LLM-reviewed | Measured cost above; lens noise turns each push into a new review round |
| Gate only `gh pr create`, push unrestricted | Simplest hook change | A push can carry code that does not compile, a secret, or a hand-edited migration |
| **Checks on push, full review on PR (chosen)** | Deterministic safety net on every push; one LLM review per PR | Lens-only issues can sit on the remote until the PR; two stamp levels |
| Keep the full gate on push but review only the diff since the last PASS | Same coverage, far fewer files per run | Needs a base-stamp chain that survives rebases; does not remove lens noise |

## Revisit when

- Pushes to an open PR start carrying lens-level problems that humans catch in
  review. Then gate those pushes on an incremental review (last alternative).
- Lens output becomes stable across runs of the same files. Then re-running the
  full review on push becomes cheap confirmation instead of new work.
