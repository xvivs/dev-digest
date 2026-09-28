---
name: pr-self-review
disable-model-invocation: true
description: "Local pre-PR gate for DevDigest: reviews the branch's committed diff with the project's architecture and stack skills (frontend-architecture, react, next, onion-architecture, fastify, drizzle, postgres, zod, security, reviewer-core purity) plus typecheck, unit tests and arch:check, and blocks git push / gh pr create on any CRITICAL. Use on /pr-self-review or when asked to self-review changes before opening a PR."
---

# PR Self-Review

Reviews **the committed changes of the current branch** (`git diff <merge-base origin/main>...HEAD`)
before they leave the machine, and writes a verdict stamp. A `PreToolUse` hook
(`scripts/gate-hook.mjs`, wired in `.claude/settings.json`) lets `git push` and
`gh pr create` through only with a PASS stamp for the current diff.

One CRITICAL blocks. There is **no waiver**: a CRITICAL goes away only by
changing the code or by the skeptic refuting it. The verdict is computed by
`scripts/self-review.mjs`, never by you. Report text is **Ukrainian**; skill,
rule and code names stay in English.

Decision record: `docs/adr/0006-local-self-review-gate.md`. Routing and
severity mapping: [references/routing.md](references/routing.md). Subagent
prompts: [references/lens-prompts.md](references/lens-prompts.md).

## Arguments

`/pr-self-review [--full] [--fix] [--base <ref>]`

- `--full`: also run the advisory lenses (`ts-advisory`, `react-perf`). They never block.
- `--fix`: after the report, apply unambiguous fixes for HIGH/MEDIUM (see step 7).
- `--base <ref>`: review against another base. The stamp is **not** written as a
  gate key then (the hook always diffs against `origin/main`); say so.

`S=.claude/skills/pr-self-review/scripts/self-review.mjs`, run from the repo root.

## Steps

1. **Collect.** `node $S collect [--full] [--base <ref>]`
   - Exit 3 `dirty`: the listed files under `client/ server/ reviewer-core/ e2e/`
     are uncommitted. Show the list and stop. Do not commit, stash or discard
     them yourself; the user decides (commit, or a WIP commit; never bare `git stash`).
   - `empty: true` → go straight to step 5 (`finalize`), it will PASS.
   - Print `warnings` to the user as they are (stale base, large diff, `--base`).
   - Keep `runDir` and `lensesToRun` for the next steps.

2. **Checks + lenses, in parallel, in one message:**
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
   ("лінза не відпрацювала"). Never write a lens file yourself.

4. **Merge + skeptic.** `node $S merge --run <runDir>`. For every item in
   `skepticQueue`, spawn one `Agent` (`general-purpose`, `model: opus`) with the
   skeptic prompt, all in one message. Collect their JSON replies into
   `<runDir>/skeptic.json` as an array `[{id, verdict, reason}]`. A reply that is
   not valid JSON counts as missing: retry that skeptic once; if still missing,
   leave it out (finalize treats it as unverified → BLOCK).

5. **Finalize.** `node $S finalize --run <runDir> [--tokens <sum of subagent tokens, if known>]`.
   It writes the stamp, the per-file cache, `refuted.jsonl`, `report.md` and
   `pr-body.md`, prints the report and exits 0 (PASS) or 4 (BLOCK). Show the
   report to the user verbatim.

6. **After the verdict.**
   - **PASS, triggered by the hook:** re-run the exact command the hook blocked.
     For `gh pr create`, append the contents of `<runDir>/pr-body.md` to `--body`.
   - **PASS, manual run:** say the gate is open for this diff; mention `pr-body.md`.
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
| `scripts/gate-hook.mjs` | `PreToolUse` hook: allows `git push` / `gh pr create` only with a PASS stamp |
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
