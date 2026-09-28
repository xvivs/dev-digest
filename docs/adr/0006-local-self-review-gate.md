# ADR 0006: Local self-review gate before push and PR

**Status:** proposed · Decisions 3 and 5 amended by [ADR 0014](0014-checks-only-push-gate.md)
**Date:** 2026-09-28

## Context

The repo already has review skills for every layer: `frontend-architecture`,
`react-best-practices`, `next-best-practices`, `onion-architecture`,
`fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
`zod`, `security`. They load only when an agent decides they are relevant, so
the code an agent pushes may never have been checked against them. `pnpm
arch:check` (ADR 0005) exists, but nothing runs it before a push.

Agents write most of the code for lessons L03–L08. Without a gate, problems
the skills already describe first show up in PR review, or never.

## Decision

1. **The `pr-self-review` skill** (`.claude/skills/pr-self-review/`) reviews the
   **committed** diff of the branch (`git diff <merge-base origin/main>...HEAD`).
   It runs the deterministic checks (typecheck, unit tests without
   `*.it.test.ts`, `arch:check`, the vendored-shared, migration, baseline and
   secret rules), then one LLM lens per group of skills in parallel.
2. **One CRITICAL blocks, with no waiver.** A CRITICAL goes away only by
   changing the code or by an `opus` skeptic refuting it (it becomes HIGH and is
   logged to `refuted.jsonl`). Each skill's own scale is mapped to one shared
   scale in code (`capSeverity()`); skills without a scale never block.
3. **Verdict stamp + Claude Code `PreToolUse` hook.** The skill writes
   `.devdigest/self-review/<diffHash>.json`. The hook
   (`scripts/gate-hook.mjs`, `.claude/settings.json`) lets `git push` and
   `gh pr create` through only with a PASS stamp for the current `diffHash`.
   The hook never runs the review: it is a file check, fast and offline.
4. **Clean tree as a precondition.** Checks read the disk, the review reads
   commits. The skill refuses to start while `client/ server/ reviewer-core/
   e2e/` have uncommitted non-Markdown changes.
5. **Fail-closed.** A lens that fails twice, an unverified CRITICAL, missing
   dependencies or a missing check result all mean BLOCK. There is no
   deterministic-only mode for an LLM outage.
6. **The verdict is computed by a script** (`self-review.mjs finalize`), never by
   the orchestrating model.

## Consequences

- An agent cannot push or open a PR with a CRITICAL the skills describe. Every
  push to an open PR is gated too.
- A WIP branch cannot be pushed "for backup" until it passes; while the LLM
  API is down, agents cannot push at all. Accepted: a gate you can skip on a
  failure stops being a gate.
- `git commit … && git push` in one command is always blocked: the hook sees
  HEAD before the commit. Agents commit, review, then push.
- Cost per run: 1–6 `sonnet` lenses plus one `opus` skeptic per CRITICAL.
  Per-file caching keyed by file content and the lens's rules means an
  iteration re-reviews only the changed files.
- **Not covered:** pushes from a terminal outside Claude Code, and merges on
  GitHub. Only a required CI check can forbid a merge.
- The skills become load-bearing: a vague rule now blocks pushes. The golden
  fixtures in `evals/` and `refuted.jsonl` are how rule quality is tracked.

## Alternatives considered

| Option | Why not (now) |
|---|---|
| Native git `pre-push` hook checking the same stamp | Catches terminal pushes, but is bypassed with `--no-verify` and needs `core.hooksPath` set on every clone. A natural second step. |
| `pre-push` running `claude -p "/pr-self-review"` headless | 1–5 minutes and tokens on every push, flaky, breaks pushing without network. |
| Required CI check on GitHub | The only real merge block, but not local, costs CI minutes, duplicates the local run. Separate task. |
| Stamp keyed by HEAD SHA | Stricter, but a rebase or amend with no code change forces a full re-run. `diffHash` invalidates on any code change and nothing else. |
| Waiver with a reason (`--waive <id>`) | Rejected by the team: CRITICAL stays absolute. The skeptic pass and the severity caps carry the false-positive risk instead. |
| Built-in `/code-review` and `/security-review` as lenses | Overlap with the project skills and bring a second, inconsistent severity scale. |
