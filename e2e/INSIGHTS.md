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

- **`agent-browser wait --text` matches CSS-transformed *rendered* text, case-sensitively.** `specs/04-pr-findings.flow.json` asserted `wait --text "Findings"` for the PR-list column header, but `client/src/app/repos/[repoId]/pulls/styles.ts:114` sets `textTransform: "uppercase"` on `headRow`, so only `FINDINGS` matches. Proven directly against agent-browser 0.27.0: `agent-browser wait --text FINDINGS` exits 0 while `wait --text Findings` times out. Correcting the case took the suite from 6/7 to 7/7 — the first time this flow has actually been executed. Write each assertion in the case the browser paints, not the case stored in `client/messages/en/*.json`. _(2026-09-20)_

- **`agent-browser find … click` silently no-ops on an element below the fold — it prints `✓ Done` and exits 0 while the click never lands** — because a flow's only assertion is the exit code, such a step is invisible: `04-pr-findings.flow.json` asserted the Warning filter for weeks while never applying it (the three follow-up `wait --text` checks are all true on the unfiltered list too, so nothing caught it). Proven on agent-browser 0.27.0: the same click flips `aria-pressed` false→true only after `scrollintoview`. Precede every `click` with `scrollintoview` and back it with a state assertion that cannot hold if the click was lost — here `get count "[data-finding-id]"` = 2 (`e2e/specs/04-pr-findings.flow.json:22-24`). _(2026-09-20)_

- **`wait --text` is case-SENSITIVE, `find text` is case-INSENSITIVE — the two locators do not agree, so case is not a disambiguator** — measured on agent-browser 0.27.0: `find text "Warning"` and `find text "warning"` both exit 0, while `wait --text "2 Warning findings in this run"` times out where `"2 WARNING FINDINGS IN THIS RUN"` passes. This kills the older advice of separating the tally pill from the filter button by case alone. Disambiguate a control by `find role button --name X --exact` (only the filter button's accessible name is exactly `Warning`; the timeline chip's is `2 Warning findings`), and write `wait --text` in the case the browser paints after `text-transform` (`e2e/specs/04-pr-findings.flow.json:23`, `e2e/specs/08-findings-popover-severity.flow.json`). _(2026-09-20)_

## Recurring Errors & Fixes

- **A flow fails on your dev DB with healthy code because the seed never repairs an existing repo — it inserts the demo repo only when it is missing** (`server/src/db/seed.ts:84`, `if (!repo)`). A database seeded before a fixture was widened keeps the old rows forever, and re-running `pnpm db:seed` does not touch them: live #482 carried 2 findings and `1/1 passed` grounding where `seed.ts` says 4 and `4/4`, so `wait --text "4 findings"` timed out against correct code. Symptom to pattern-match: a count assertion fails locally but the same flow passes under `./scripts/e2e.sh`, whose Postgres is ephemeral and therefore always matches `seed.ts`. Trust the hermetic run; do not "fix" the flow to match a stale database. _(2026-09-20)_

## Session Notes

### 2026-09-20 — FINDINGS feature (e2e) session
Rewrote `specs/04-pr-findings.flow.json` for the widened seed: PR #482 now carries 1 CRITICAL + 2 WARNING + 1 SUGGESTION, and the two warnings are what make the filter assertion meaningful — one finding per level cannot distinguish a real counter from a hardcoded "1". The flow asserts the FINDINGS column header, the three tally pills, that both warnings survive the Warning filter, and that clearing it restores the critical finding. NOT run: `agent-browser` is not installed in this worktree (`npx` wants to fetch 0.27.0), so the flow is written but unverified — it needs `./scripts/e2e.sh` on a machine that has it.

### 2026-09-20 — e2e coverage catch-up session
Grew the suite from 7 flows to 10 and ran it for real: `08-findings-popover-severity` (hover/focus scoping of the findings popover), `09-disclosure-a11y` (`aria-expanded` counts across collapse/expand, keyboard Enter on a card trigger) and `10-run-cost-and-timeline` (cost provenance on three surfaces, derived timeline badges, trace drawer stats). Repaired `04-pr-findings`, whose filter assertions had been passing without the filter ever being applied, and added the `wait --text "acme/payments-api"` guard to every repo-specific flow now that the seed intentionally holds a second repo (`xvivs/dev-digest`) and `listByWorkspace` has no `ORDER BY`. Result: 10/10 via `./scripts/e2e.sh`. Not covered and not silently dropped: the popover's unscoped header (needs a cursor position no selector can express), `ToolCallRow` (seed has no tool calls), and the collapse animation itself (only its `aria-expanded` outcome is asserted, never the curve).

## Open Questions

- **Conflict to resolve at cleanup: the "What Doesn't Work" entry above claims agent-browser has no hover command and that case separates the tally pill from the filter button. Both halves are now disproven** — `agent-browser --help` (0.27.0) documents `hover`, `focus`, `is visible|enabled|checked` and `get count|attr`, and `find text` turns out to be case-insensitive. The hover popover is covered end to end by `e2e/specs/08-findings-popover-severity.flow.json`, and negative checks are expressible as `get count "<sel>"` + `assert.stdoutIncludes`. The entry is left in place because this journal is append-only; a human should retire it during cleanup rather than have two entries disagree. _(2026-09-20)_
