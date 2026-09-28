# ADR 0004 — `AGENTS.md` holds agent instructions; `CLAUDE.md` only imports it

**Status:** accepted
**Date:** 2026-09-28

## Context

The repo kept its agent instructions in six `CLAUDE.md` files: the root,
`server/`, `client/`, `reviewer-core/`, `e2e/` and
`server/src/modules/repo-intel/`. Only Claude Code reads that filename. Cursor
and Antigravity read `AGENTS.md`, so anyone opening the repo in those tools got
none of the rules: no "Do not touch" list, no DI boundary, no `*.it.test.ts`
naming.

Claude Code 2.1.277 added an `AGENTS.md` fallback. Its changelog entry reads:
"in a project with no CLAUDE.md, Claude Code reads AGENTS.md instead". The entry
says nothing about nested files. We tested it on 2.1.283 in a scratch repo with a
root and a nested `AGENTS.md`, each carrying a marker string:

| Setup | Runs that saw both markers |
|---|---|
| `AGENTS.md` only | 5 of 6 (one run reported none) |
| `AGENTS.md` + `CLAUDE.md` stub containing `@AGENTS.md` | 5 of 5 |

The logs do not show whether the failed run was a loader miss or a model
misreport. Either way, a pure rename would leave Claude Code sessions with a
chance of running without the rules, and nothing would warn anyone.

## Decision

- Each of the six directories keeps its full instructions in `AGENTS.md`.
- Next to each one sits a `CLAUDE.md` with a single line: `@AGENTS.md`. Claude
  Code resolves the import explicitly and does not depend on the fallback.
- Live references (`docs/**/README.md`, the root `AGENTS.md`, a comment in
  `server/src/modules/pulls/status.ts`) now point at `AGENTS.md`. The
  `engineering-insights` skill says "`AGENTS.md` (or `CLAUDE.md`)" because it
  also runs in repos that have not switched.

## Consequences

### What this enables

- Claude Code, Cursor and Antigravity read the same rules from the same file.
- A rule change lands in one place per directory.

### What this costs

- Six extra one-line files. A newcomer may open `CLAUDE.md`, see one line and
  wonder where the rules went. The import line answers that.
- Git records `CLAUDE.md` as modified and `AGENTS.md` as new, because the
  stub keeps the old path alive. Rule history from before this change stays on
  `CLAUDE.md`: run `git log -- CLAUDE.md` for it, and `git log -- AGENTS.md`
  for everything after.

### What this forbids

- Writing rules into a `CLAUDE.md` stub. Claude Code would see them and the
  other tools would not. Edit `AGENTS.md`.
- Adding a directory-level `AGENTS.md` without its stub. Claude Code may skip it.

## Alternatives considered

| Option | Why not |
|---|---|
| **Rename only, rely on the fallback** | Cleanest tree. Rejected on the test above: one run in six saw no instructions, and the changelog documents the fallback for the root only. |
| **`CLAUDE.md` as a symlink to `AGENTS.md`** | One file, full content visible to Claude Code. Rejected because git on Windows checks symlinks out as plain text files unless `core.symlinks` is on, and some editors and indexers do not follow them. |
| **Keep `CLAUDE.md`, add a stub `AGENTS.md` pointing at it** | `@` imports are a Claude Code feature. A tool that does not resolve them would show its agent a pointer instead of the rules. |

## Revisit when

- Claude Code documents `AGENTS.md` loading for nested directories and the test
  above passes reliably. Then delete the stubs.
- The `/config` "Project instructions" setting becomes something the repo can
  set for everyone, instead of each developer.
