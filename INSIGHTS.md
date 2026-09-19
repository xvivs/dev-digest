# INSIGHTS — repo-wide

Append-only journal of things that cost us time. Write here **first** and
without a filter: an entry is cheap, a line in `CLAUDE.md` is not.

Scope: findings that cross package boundaries. Package-local findings belong in
`server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md`,
`e2e/INSIGHTS.md`, or `server/src/modules/repo-intel/INSIGHTS.md`.

Priority: anything that surprised you, broke in a non-obvious way, or where the
obvious fix turned out to be wrong.

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly cleanup —
lives in the engineering-insights skill).

## What Works

## What Doesn't Work

## Codebase Patterns

- **INSIGHTS.md files use a fixed 7-section taxonomy (What Works / What Doesn't Work / Codebase Patterns / Tool & Library Notes / Recurring Errors & Fixes / Session Notes / Open Questions), not the older flat Symptom/Cause/Fix/Recurrence format.** — Migrated by the `engineering-insights` skill (`~/.claude/skills/engineering-insights/SKILL.md`) to match the course lesson's spec; each module's old per-file nuance survives as a `Priority:` line in the intro, above the section headings. _(2026-09-19)_

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

### 2026-09-19 — repo-wide session

Built the `engineering-insights` skill (`~/.claude/skills/engineering-insights/SKILL.md`) to capture durable learnings into each module's `INSIGHTS.md`. Chose the course slide's fixed 7-section taxonomy over the repo's pre-existing flat Symptom/Cause/Fix format after comparing both via two parallel design agents; migrated all six `INSIGHTS.md` files and updated all six `CLAUDE.md` files to read/update them unconditionally, closing a gap where `repo-intel/CLAUDE.md` previously had no `INSIGHTS.md` pointer at all.

## Open Questions

- **The old Promotion Rule (a finding hit twice escalates a one-liner to `CLAUDE.md`) has no equivalent in the new 7-section shape.** — `engineering-insights` only asks the agent to mention a suspected repeat in its report, never to auto-edit `CLAUDE.md`; worth deciding whether a future monthly cleanup pass should manually re-adopt a promotion step (see `references/cleanup-and-sharding.md` in the skill). _(2026-09-19)_
