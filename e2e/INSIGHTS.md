# INSIGHTS — e2e

Append-only journal of things that cost us time in the browser suite. Write
here **first** and without a filter: an entry is cheap, a line in `CLAUDE.md`
is not.

Findings that cross package boundaries go in the repo-root `../INSIGHTS.md`.

Priority: flakiness above all else — a flow that failed once and passed on
retry is exactly the kind of finding that gets forgotten and re-debugged, and
deserves an entry even without a fix yet.

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly cleanup —
lives in the engineering-insights skill).

## What Works

## What Doesn't Work

- **agent-browser has no negative text assertion and no documented hover command, so "the filter HID something" is not expressible in a flow** — `wait --text` only proves presence, and `e2e/README.md` restricts locators to `--url`, `--text`, `find role|text|label`. `04-pr-findings.flow.json` therefore asserts what is provable (tally pills render, both WARNING findings survive the filter, clearing restores the CRITICAL one) and leaves hiding and the hover popover to vitest+jsdom. Design locators so they cannot collide: the tally pills render uppercase ("2 WARNING"), the filter buttons title case ("Warning"), and the timeline severity chips render only an icon plus a number, carrying their words in `aria-label`. _(2026-09-20)_

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

### 2026-09-20 — FINDINGS feature (e2e) session
Rewrote `specs/04-pr-findings.flow.json` for the widened seed: PR #482 now carries 1 CRITICAL + 2 WARNING + 1 SUGGESTION, and the two warnings are what make the filter assertion meaningful — one finding per level cannot distinguish a real counter from a hardcoded "1". The flow asserts the FINDINGS column header, the three tally pills, that both warnings survive the Warning filter, and that clearing it restores the critical finding. NOT run: `agent-browser` is not installed in this worktree (`npx` wants to fetch 0.27.0), so the flow is written but unverified — it needs `./scripts/e2e.sh` on a machine that has it.

## Open Questions
