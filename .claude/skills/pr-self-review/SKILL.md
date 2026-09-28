---
name: pr-self-review
disable-model-invocation: true
description: "Local pre-PR gate for DevDigest: reviews the branch's committed diff with the project's architecture and stack skills (frontend-architecture, react, next, onion-architecture, fastify, drizzle, postgres, zod, security, reviewer-core purity) plus typecheck, unit tests and arch:check, and blocks git push / gh pr create on any CRITICAL. Use on /pr-self-review or when asked to self-review changes before opening a PR."
---

# PR Self-Review

Reviews **the committed changes of the current branch** (`git diff <merge-base origin/main>...HEAD`)
before they leave the machine, and writes a verdict stamp with a `level`:
`checks` (deterministic checks only) or `full` (checks + LLM lenses). A
`PreToolUse` hook (`scripts/gate-hook.mjs`, wired in `.claude/settings.json`)
lets `git push` through with a PASS stamp of **either** level, and `gh pr
create` through only with a PASS stamp of level `full`.

One CRITICAL blocks. There is **no waiver**: a CRITICAL goes away only by
changing the code or by the skeptic refuting it. The verdict is computed by
`scripts/self-review.mjs`, never by you. Report text is **Ukrainian**; skill,
rule and code names stay in English.

Decision records: `docs/adr/0006-local-self-review-gate.md` (the gate itself)
and `docs/adr/0014-checks-only-push-gate.md` (the `checks`/`full` split).
Routing and severity mapping: [references/routing.md](references/routing.md).
Subagent prompts: [references/lens-prompts.md](references/lens-prompts.md).

## Arguments

`/pr-self-review [--full] [--checks-only] [--fix] [--base <ref>]`

- `--full`: also run the advisory lenses (`ts-advisory`, `react-perf`). They never block.
- `--checks-only`: skip every LLM lens — only the deterministic checks
  (typecheck, unit tests, `arch:check`, static rules) run. Writes a stamp of
  level `checks`, which the hook accepts for `git push` but not for
  `gh pr create`. Errors if combined with `--full`. Never downgrades an
  existing `full` PASS stamp for the same diff — a stronger stamp already on
  disk is left alone.
- `--fix`: after the report, apply unambiguous fixes for HIGH/MEDIUM (see step 7).
- `--base <ref>`: review against another base. The stamp is **not** written as a
  gate key then (the hook always diffs against `origin/main`); say so.

`S=.claude/skills/pr-self-review/scripts/self-review.mjs`, run from the repo root.

## Steps

1. **Collect.** `node $S collect [--full | --checks-only] [--base <ref>]`
   - Exit 3 `dirty`: the listed files under `client/ server/ reviewer-core/ e2e/`
     are uncommitted. Show the list and stop. Do not commit, stash or discard
     them yourself; the user decides (commit, or a WIP commit; never bare `git stash`).
   - `empty: true` → go straight to step 5 (`finalize`), it will PASS.
   - `--checks-only`: `lensesToRun` comes back empty and `level: "checks"`.
     Skip straight from `collect` to `check` (step 2's Bash line only — spawn no
     `Agent`), then `merge` (step 4; `skepticQueue` will be empty, spawn no
     skeptic), then `finalize` (step 5). Otherwise `level: "full"`.
   - Print `warnings` to the user as they are (stale base, large diff, `--base`).
   - Keep `runDir` and `lensesToRun` for the next steps.

2. **Checks + lenses, in parallel, in one message** (for a `--checks-only` run,
   this is only the Bash line below — spawn no `Agent`):
   - Bash: `node $S check --run <runDir>` (timeout 600000; typecheck + unit tests
     can take minutes).
   - One `Agent` per entry in `lensesToRun` (skip when `docsOnly: true`),
     `subagent_type: general-purpose`, `model: sonnet`, prompt = the lens prompt
     from `references/lens-prompts.md` with the lens-specific block and slots
     filled from collect output. Lenses with only cached files are not in
     `lensesToRun`; do not spawn them.

3. **Lens failures, one retry.** For each lens that failed (agent error, or no
   valid `<runDir>/lens-<lens>.json`), spawn it once more with the same prompt.
   If it fails again, leave it: `merge` marks it failed and the verdict is BLOCK
   ("лінза не відпрацювала"). Never write a lens file yourself. (Nothing to do
   here for a `--checks-only` run: there are no lenses to have failed.)

4. **Merge + skeptic.** `node $S merge --run <runDir>`. For every item in
   `skepticQueue`, spawn one `Agent` (`general-purpose`, `model: opus`) with the
   skeptic prompt, all in one message. Collect their JSON replies into
   `<runDir>/skeptic.json` as an array `[{id, verdict, reason}]`. A reply that is
   not valid JSON counts as missing: retry that skeptic once; if still missing,
   leave it out (finalize treats it as unverified → BLOCK). For a
   `--checks-only` run `skepticQueue` is always empty — spawn nothing.

5. **Finalize.** `node $S finalize --run <runDir> [--tokens <sum of subagent tokens, if known>]`.
   It writes the stamp (with `level: "checks"` or `"full"`), the per-file cache,
   `refuted.jsonl`, `report.md` and `pr-body.md` — except a `--checks-only` run
   writes neither the per-file lens cache nor `refuted.jsonl` (there is nothing
   for either to record), and never overwrites an existing `full` PASS stamp for
   the same diff with its own `checks` one. It prints the report (its header
   states the level) and exits 0 (PASS) or 4 (BLOCK). Show the report to the
   user verbatim.

6. **After the verdict.**
   - **PASS, triggered by the hook:** the hook's block message named the mode to
     run — `/pr-self-review --checks-only` for a blocked `git push`,
     `/pr-self-review` for a blocked `gh pr create`. Run exactly that mode, then
     re-run the exact command the hook blocked. For `gh pr create`, append the
     contents of `<runDir>/pr-body.md` to `--body`.
   - **PASS, manual run:** say the gate is open for this diff at this run's
     level (`checks` opens `git push` only; `full` opens both); mention `pr-body.md`.
   - **BLOCK:** list what blocks, with the fix for each. Do not retry the push.
     After the user's fixes are committed, run `/pr-self-review` again. Only files
     whose content changed are re-reviewed (per-file cache).

7. **`--fix` (only when asked).** For HIGH/MEDIUM findings with a single,
   unambiguous `fix`, apply the edit. For CRITICAL, only propose the change and
   let the user decide: they must see what changes in blocking places. Show the
   resulting diff, ask before committing (the tree must be clean for the next
   run), then re-run from step 1.

8. **Wrap-up.** If `.devdigest/self-review/refuted.jsonl` has ≥3 entries for the
   same `skill`+`rule`, tell the user the rule produces false CRITICALs and
   propose sharpening that skill; file it through `engineering-insights`.

## Never

- Never create, edit or delete a stamp (`.devdigest/self-review/<hash>.json`),
  a lens file, `merged.json` or `checks.json` by hand, and never change a
  severity yourself. Only the scripts and the subagents write them.
- Never bypass the gate: no `--no-verify`, no running the push through another
  tool, no editing `.claude/settings.json` to drop the hook.
- Never chain a commit and a push in one command (`git commit … && git push`).
  The hook blocks it: it sees HEAD before the commit. Commit, review, then push.
- Never cap coverage silently. If a lens or check did not run, the report's
  "Пропущено" line or "Що блокує" section must say so.

## What is where

| Path | Role |
|---|---|
| `scripts/lib.mjs` | diff + `diffHash`, dirty-tree check, routing, severity caps, cache key |
| `scripts/self-review.mjs` | `collect` / `check` / `merge` / `finalize` |
| `scripts/gate-hook.mjs` | `PreToolUse` hook: allows `git push` with a PASS stamp of level `checks` or `full`; `gh pr create` only with level `full` (a stamp with no `level` field is legacy and counts as `full`) |
| `references/routing.md` | file → lens → skills, severity mapping, deterministic checks |
| `references/lens-prompts.md` | lens and skeptic contracts, `core-purity` checklist |
| `evals/` | golden fixtures for the skill itself, see `evals/README.md` |
| `.devdigest/self-review/` (gitignored) | stamps, `runs/<diffHash>/`, `cache/`, `refuted.jsonl` |

## Verification (after changing this skill)

```sh
node --check .claude/skills/pr-self-review/scripts/*.mjs
bash .claude/skills/pr-self-review/evals/hook-cases.sh      # hook allow/block matrix, no LLM
bash .claude/skills/pr-self-review/evals/run-fixtures.sh    # deterministic half on each fixture
```

Then run the full skill on at least one BLOCK fixture and the clean fixture
(`evals/README.md`). Changing a lens prompt or a routed skill's `SKILL.md`
invalidates the cache on its own.
