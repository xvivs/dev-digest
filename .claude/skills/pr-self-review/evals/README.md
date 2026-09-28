# pr-self-review evals

Golden fixtures for the skill itself. Run them after changing a script, a lens
prompt, the routing, or any skill a lens applies.

Each fixture in `fixtures/<name>/` is a set of new files (`files/`, laid out
from the repo root) plus `expected.json`. The harness copies them into a
throwaway detached worktree of `HEAD` (with a snapshot of the working copy's
`.claude/skills`, so uncommitted skill edits are what gets tested), commits
them, and reviews that single commit (`--base` = the snapshot commit).
`node_modules` are copy-on-write clones of this checkout's, so install dependencies here first.

| Fixture | Expected | What it proves |
|---|---|---|
| `onion-nonatomic` | BLOCK, `server-arch` CRITICAL | two dependent deletes outside `store.transaction()` (onion rule 9) |
| `react-derived-state` | BLOCK, `client-arch` CRITICAL | derived value stored in state and synced in `useEffect` |
| `vendored-drift` | BLOCK, check `vendored-shared` | one copy of `@devdigest/shared` changed |
| `core-io` | BLOCK, `core-purity` CRITICAL | `node:fs` inside reviewer-core (P1) |
| `clean` | PASS, 0 CRITICAL | a pure helper; a MEDIUM for a missing test is fine |

## Deterministic half (no LLM, ~30 s)

```sh
bash .claude/skills/pr-self-review/evals/hook-cases.sh    # hook allow/block matrix
bash .claude/skills/pr-self-review/evals/run-fixtures.sh  # routing + checks for every fixture
```

`run-fixtures.sh` asserts `deterministic.mustFail` / `mustPass`, that no other
CRITICAL check fails, and that every expected lens finding's file is routed to
that lens. It then runs one extra, self-contained case: the `clean` fixture
through `collect --checks-only` → `check` → `merge` → `finalize` end to end (no
LLM, since a checks-only run spawns no lens or skeptic), asserting `level:
"checks"` (from `collect`'s own output and the report's level line), a PASS
verdict, and that no per-file lens cache file was written.

`hook-cases.sh` also covers the `checks`/`full` stamp levels: a `checks` stamp
opens `git push` but not `gh pr create`; a `full` or legacy (no `level` field)
stamp opens both; a BLOCK stamp of either level opens neither.

## Full run (LLM)

```sh
bash .claude/skills/pr-self-review/evals/run-fixtures.sh --keep react-derived-state
```

prints a worktree path and a `runDir`. From that worktree, run steps 2–5 of
`SKILL.md` against that `runDir`, with the lens and skeptic prompts
using the printed worktree as `{root}`. Compare `report.md` with
`expected.json`: the verdict must match, and each `lensFindings` entry must
appear with that lens, file and severity (its `rule` matching `ruleMatches`).
Then remove the worktree: `git worktree remove --force <path>`.

Minimum before shipping a change: every fixture's deterministic half, and a
full run on `clean` plus at least one BLOCK fixture whose lens you touched.
