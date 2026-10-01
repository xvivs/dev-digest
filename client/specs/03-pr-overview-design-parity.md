# Spec: PR Overview tab, design parity (visual only)

**Status:** draft · **Branch:** `feat/smart-diff` · **Approach:** restyle in place to the `pr-overview` artboard of `DevDigest Design.html`; no data, API or contract changes. Source analysis: `client/specs/research-pr-overview-design.md` (gap table, `path:line`). **Ground truth: the screenshot `client/specs/assets/pr-overview-design.png`** (current state: `assets/pr-overview-current.png`); where it differs from the decoded manifest in the research, the screenshot wins.

Scope: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/**` (abbreviated `OT/`), `client/messages/en/brief.json`. Not touched: `server/**`, `reviewer-core/**`, `*/vendor/shared/**`, new dependencies, `PrDetailView` spacing, `SectionLabel` primitive.

## Problem & Motivation

The Overview tab uses four separate cards, a 3px-bar quote, pill-shaped tinted risk chips, a big-number blast header, and an oversized empty "Review brief" block on PRs that never ran an agent. The design has two cards, a compact intent, and no brief block without runs.

## Goals / Non-goals

### Goals
Layout and styling as in the design (research "Design structure"), plus the five user decisions below.

### Non-goals
Server/API/shared-contract changes; narrow-viewport redesign (INSIGHTS.md:281, issue #10); changing `SectionLabel` (12px/mb14 vs design 11px/mb12, shared primitive); the VerdictBanner internals; page padding.

### Decisions (binding, from the user)
1. Two cards in a `1fr 1fr` grid, gap 16: left = Intent, divider, Risk areas; right = Blast radius, divider, Prior PRs. Card radius 8. Description (`pr.body`) is removed (user decision after review; not in the design).
2. Intent per design: italic 14px quote in typographic quotes, no accent bar; In/Out of scope in a 2-column grid with `Check`/`X` headers, "·" bullets, out-of-scope muted.
3. Confidence badge only for `low` and `medium`; compact.
4. Sources, Links not read, Derivation cost go into a closed `Disclosure` titled "Details". `Disclosure` exists in `@devdigest/ui` (`src/vendor/ui/primitives/Disclosure.tsx`, already used by `PriorPrs`); no new primitive.
5. Brief section: a `FileText` label row "PR BRIEF" (uppercase, muted, small) above the VerdictBanner, as in the screenshot; not rendered when `usePrRuns` is `isSuccess && data.length === 0`; loading and error still render; runs exist but no completed brief gives a compact bordered card no taller than the VerdictBanner: one row with a small icon, "No completed review yet" and the hint.
6. Screenshot specifics: the grid uses default stretch, so the left card grows to the right card's height (drop `alignItems: start`); Blast stats are one row "icon + bold number + label" with the segmented Tree/Graph toggle (capitalised labels) in the same row; Prior PRs is a bordered accordion at the bottom of the right card with a count badge.

### Decisions (verified / assumed)
- Verified: `GET /pulls/:id/runs` returns review runs only. `listRunsForPull` selects from `agent_runs` joined to `agents` (`server/src/modules/reviews/repository/run.repo.ts:52-62`); the brief derivation does not write `agent_runs` (only `evals`, `pulls`, `skills`, `reviews` repos reference that table). So `length === 0` means "no review run ever".
- Verified: only `OverviewTab` uses the `brief` i18n namespace (`useTranslations("brief")` grep), so changing string values is safe. `block.risks` and `history.title` values change.
- Decided (was Assumed; revisit only if the user objects): the grid is `repeat(auto-fit, minmax(min(340px, 100%), 1fr))`, gap 16, which equals `1fr 1fr` at the 1080px content width and keeps the existing narrow collapse (INSIGHTS.md:281).
- Decided: stale badge, Refresh button, failure notice, "deriving" status and the low-confidence hint stay (functional, `IntentCard.tsx:88-103`); the `opacity: .8` dimming is dropped (not in design). Dropping the `high` badge removes a redundant signal; `low`/`medium` keep it.
- Decided: risk footer (dropped refs, cost), "based on index" badge and degraded/truncated notices in Blast stay as they are. The risk footer's `risks.cost` text is separate from `intent.cost`.
- Decided: risk pill severity word becomes `VisuallyHidden` text, so severity is still not colour-only (`constants.ts`).
- Decided (architecture review AR-1): `s.col` stays in route `styles.ts` because `BriefSection` uses it; it is not deleted.
- No ADR needed: no new pattern.

## Acceptance criteria (EARS)

- **AC-1.** When the PR has no agent run (`usePrRuns` success, empty list), the Overview tab shall render no PR brief section and no PR brief heading.
- **AC-2.** While runs or reviews are loading or errored, the PR brief section shall still render its heading with a skeleton or error state.
- **AC-3.** The PR brief section shall show a "PR brief" label row (`FileText` icon) above the VerdictBanner.
- **AC-4.** When runs exist but none has a completed review, the section shall show a single-row compact card (small icon, "No completed review yet", hint), not the `EmptyState` block, with height at or below the VerdictBanner's.
- **AC-5.** When intent confidence is `low` or `medium`, the Intent header shall show a compact confidence badge; when `high`, it shall show none.
- **AC-6.** The Intent block shall render the intent text in typographic quotes, italic 14px, with no left accent border.
- **AC-7.** The In scope and Out of scope lists shall render in a two-column grid, headed by `Check` / `X` icons and uppercase 11px labels; items shall carry a "·" bullet and out-of-scope items shall use the muted colour.
- **AC-8.** The Intent block shall contain a "Details" disclosure, closed by default, that holds Sources, Links not read (when any) and the intent Derivation cost (`intent.cost`); none of these shall be visible while it is closed.
- **AC-9.** The Overview grid shall contain exactly two cards (radius 8, padding `var(--card-pad)`): Intent + Risk areas, and Blast radius + Prior PRs, each pair separated by a 1px divider with 16px vertical margin; the grid shall stretch the cards to equal height.
- **AC-10.** Risk pills shall be border-only, radius 6, 12px/500, with the severity colour on the icon only; the severity shall remain available as visually hidden text.
- **AC-11.** The Blast radius header shall show inline stats (icon, bold number, label) and the tree/graph toggle in one row, the toggle right-aligned with surface background.
- **AC-12.** Prior PRs shall render inside the right card as a bordered (radius 7) Disclosure titled "Prior PRs touching these files" in 12.5px/600 non-uppercase text with a count badge, closed by default.
- **AC-13.** (revised by user, 2026-10-01) The Overview tab shall not render the PR description (`pr.body`); it is absent from the design.

## Change sites

| # | File (under `OT/` unless noted) | Change | Layer | AC | Risk |
|---|---|---|---|---|---|
| 1 | `client/messages/en/brief.json` | `section` -> "PR brief"; `block.risks` -> "Risk areas"; `history.title` -> "Prior PRs touching these files"; add `details` ("Details") | client (i18n) | 3,8,12 | low |
| 2 | `constants.ts` | `CONFIDENCE_BADGE_LEVELS` (`low`,`medium`) as the single source of the rule | client | 5 | low |
| 3 | `helpers.ts` (+ `helpers.test.ts`) | pure `shouldShowConfidenceBadge(c)` reading `CONFIDENCE_BADGE_LEVELS`; the no-runs check stays inline in `BriefSection` | client (domain) | 5 | low |
| 4 | `styles.ts` | `card` -> radius 8, `padding: "var(--card-pad, 16px)"`; add `divider` (1px, `margin: 16px 0`); `grid` gap 16, no `alignItems: start`; `col` kept (used by `BriefSection`); add `briefEmpty` single-row card style for AC-4 | client | 4,9 | low |
| 5 | `OverviewTab.tsx` | two `<section style={s.card}>` each holding block, divider, block; Description unchanged | client (view) | 9,13 | low |
| 6 | `_components/BriefSection/BriefSection.tsx` | early `return null` when runs succeeded and empty (after hooks); `FileText` label "PR BRIEF"; compact single-row card instead of `EmptyState` | client | 1-4 | med (hook order) |
| 7 | `_components/IntentCard/IntentCard.tsx`, `styles.ts` | drop own card chrome (`<div>`), italic quoted `<blockquote>`, scope grid with icons, "·" bullets, badge gating, remove `lowCard` | client | 5-7 | med |
| 8 | `_components/IntentCard/_components/IntentDetails/{IntentDetails.tsx,styles.ts,index.ts}` | new: `Disclosure` "Details" with Sources, Links not read, cost; text stays JSX text (no anchors) | client | 8 | low |
| 9 | `_components/RiskAreas/RiskAreas.tsx`, `styles.ts` | drop card chrome; pill + detail restyle; severity in `VisuallyHidden` | client | 10 | low |
| 10 | `_components/BlastRadiusCard/BlastRadiusCard.tsx`, `styles.ts` | drop card chrome; stats+toggle row with icons (`Code`, `CornerDownRight`, `Globe`, `Clock`); toggle restyle, capitalised labels | client | 11 | low |
| 11 | `_components/PriorPrs/PriorPrs.tsx`, `styles.ts` | drop card chrome; bordered radius-7 Disclosure, count badge; heading restyle | client | 12 | low |
| 12 | `BriefSection.test.tsx`, `IntentCard.test.tsx`, `RiskAreas.test.tsx`, `PriorPrs.test.tsx`, `OverviewTab.test.tsx` (beside each component) | new RTL tests | client (test) | 1-8 | low |

Skipped layers: no domain/app/infra/wiring/core. Frontend layering: new subcomponent is local to its only consumer (promotion rule); styles in `styles.ts`; strings via `next-intl`.

## Steps

1. i18n: edit `messages/en/brief.json` (site 1) — verify: `cd client && pnpm typecheck` -> exit 0; `grep -n '"section"\|"details"' messages/en/brief.json` shows the new values.
2. Constants/helpers: `CONFIDENCE_BADGE_LEVELS`, `shouldShowConfidenceBadge` and cases in `helpers.test.ts` (sites 2-3) — verify: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/helpers.test.ts"` -> pass.
3. Layout unit: shared styles, `OverviewTab.tsx` two-card wrapper AND card-chrome removal in `IntentCard`, `RiskAreas`, `BlastRadiusCard`, `PriorPrs` (sites 4-5 plus the chrome part of 7, 9-11), so no double borders at any commit — verify: `cd client && pnpm typecheck` -> exit 0.
4. `BriefSection`: no-runs null, label, compact empty card (site 6); every hook stays above the early return — verify: `cd client && pnpm typecheck`.
5. `IntentCard` restyle + `IntentDetails` (sites 7-8) — verify: `cd client && pnpm typecheck`.
6. `RiskAreas` pills and detail (site 9) — verify: `cd client && pnpm typecheck`.
7. `BlastRadiusCard` stats row and toggle (site 10) — verify: `cd client && pnpm typecheck`.
8. `PriorPrs` accordion (site 11) — verify: `cd client && pnpm typecheck`.
8a. Blast tree parity (added by user): compare the symbol tree in `BlastRadiusCard` (and its tree subcomponent) against `assets/pr-overview-design.png`. Target: symbol row with chevron + `<>` icon + mono name, "N callers" right-aligned muted; nested caller paths mono with `↳`; endpoint chips mono blue with `Globe` icon; cron chip mono amber with `Clock` icon. Change only what differs; if it already matches, record "no change" in the hand-back — verify: `cd client && pnpm typecheck`.
8b. VerdictBanner parity (added by user): compare the VerdictBanner against the screenshot. Target: verdict icon in a tinted rounded square, verdict label coloured 600 + findings/blockers chip, 2-line muted summary, score ring with "PR SCORE" caption on the right, mono cost/tokens line under it. Change only what differs; if it already matches, record "no change" — verify: `cd client && pnpm typecheck`.
9. Tests (site 12) — verify: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab"` -> all pass.
10. Full gate — verify: `cd client && pnpm typecheck && pnpm test` -> pass; then browser check of Overview at 1440 and 390 px against `assets/pr-overview-design.png` (cards stretch to equal height, Details/Prior PRs closed, no horizontal overflow, zero-run PR shows no brief).
11. File durable learnings via the `engineering-insights` skill (e.g. `Disclosure` unmounts its closed body, so "absent until opened" is testable) — verify: new entries present in `client/INSIGHTS.md`.

## Test plan

Behaviour-only RTL via `renderWithProviders` (`src/test/render.tsx`) with `namespaces={{ brief: briefMessages }}` and the faked `fetch` (`src/test/fake-api.ts`); query real hooks, mock the network. Run payloads must satisfy the `RunSummary` / intent contracts.

| AC | Test file | Kind | Case |
|---|---|---|---|
| 1 | `OT/_components/BriefSection/BriefSection.test.tsx` | RTL | `/pulls/p1/runs` -> `[]`: after settle, no "PR brief" text, container empty |
| 2 | same | RTL | runs request errors: "PR brief" heading and error state with retry shown |
| 3,4 | same | RTL | runs `[done run]`, reviews `[]`: "PR brief" label and "No completed review yet" present, no "Review brief", no EmptyState block |
| 5 | `OT/_components/IntentCard/IntentCard.test.tsx` | RTL | confidence `low` and `medium` -> badge text present; `high` -> `queryByText(/confidence/i)` null |
| 8 | same | RTL | "Details" button has `aria-expanded=false`; "Sources" text absent; click -> Sources visible; intent cost text scoped with `within` |
| 10 | `OT/_components/RiskAreas/RiskAreas.test.tsx` | RTL | high-severity risk: pill present and the text "High" is in the document (severity not colour-only) |
| 12 | `OT/_components/PriorPrs/PriorPrs.test.tsx` | RTL | Disclosure button `aria-expanded=false`, title "Prior PRs touching these files", history items absent until click |
| 13 | `OT/OverviewTab.test.tsx` | RTL | no Description block rendered (OverviewTab no longer receives `pr`, so `pr.body` cannot reach it) |
| 6,7 | same | RTL | quote text appears wrapped in “ ”; both scope headings and items render |
| 5 (pure) | `OT/helpers.test.ts` | unit | `shouldShowConfidenceBadge` for high/medium/low |

AC-9 and AC-11 (layout, stretch, row composition) are visual; covered by the step-10 browser check (jsdom has no layout), no style-value assertions. The IntentCard test scopes cost text with `within` because the risk footer keeps its own "Derivation cost".

## Review log

| Round | Reviewer | Finding | Severity | Resolution |
|---|---|---|---|---|
| 1 | architecture-reviewer | AR-1 `s.col` still used by `BriefSection` | MEDIUM | fixed in Decisions + site 4 |
| 1 | architecture-reviewer | shallow `isNoRuns`; constant/helper single source | open question | fixed in sites 2-3 |
| 1 | plan-critic | PC-1 AC-10/12/13 untested | MAJOR | fixed in Test plan |
| 1 | plan-critic | PC-2 double borders between steps | MINOR | fixed in step 3 |
| 1 | plan-critic | PC-3 duplicate "Derivation cost" | MINOR | fixed in AC-8, Test plan |
| 1 | plan-critic | PC-4 open assumptions | MINOR | moved to Decided |
| 1 | plan-critic | PC-5 insights step | MINOR | fixed, step 11 |

One review round by instruction; no re-review. The coordinator's screenshot (ground truth) was applied after the round: PR BRIEF label row, compact empty card, stretch, Blast row, Prior PRs accordion.

## Edge cases

- Runs query refetching (polling while `running`): `data` stays defined, so the section does not flicker to null.
- Runs exist but only `running`/`failed`: section stays, compact empty line (existing "newer run" notice only appears with a brief).
- Intent `null` / in-flight / failure branches keep their current states inside the left card.
- Zero risks, zero blast, prior PRs unavailable: each block's empty/error state renders inside the shared card, divider still shown.
- Long unbroken text in quote/pills: keep `overflowWrap: anywhere`, `minWidth: 0` on grid children.
- Out-of-scope or in-scope list empty: keep the "Nothing listed." muted line.

## Risks & rollback

1. Early `return null` placed before a hook breaks hook order — step 4: hooks first, return last.
2. Removing card chrome from blocks leaves loading/error branches double-bordered or unbordered — steps 5-8 and the browser check.
3. Dropping `opacity .8` and the badge for high is a UX change beyond pure styling — listed under Decided.
4. Narrow screens: no design reference; relying on auto-fit collapse — verified at 390 px in step 10.
Rollback: revert the single commit; no data or contract change.

## Untrusted inputs

Intent text, sources, unresolved URLs, risk titles/explanations and PR body are model- or PR-derived. They stay rendered as JSX text only (no `dangerouslySetInnerHTML`, no `href` from unresolved links); the `“ ”` wrapping is added in JSX, not concatenated into HTML.

## Relevant INSIGHTS entries

`client/INSIGHTS.md:281` (Overview shipped, narrow-width gaps, issue #10), `:109` (sticky offset), `:115` (chevrons); frontend-architecture promotion rule and `ADR 0003` (inline CSS-var styles in `styles.ts`).

## Open questions

- None blocking. The Decided items (auto-fit grid, hint kept / dimming dropped, risk footer and "based on index" kept) are open to user veto.

## Skills applied

`frontend-architecture`, `react-best-practices`, `react-testing-library`, `security`, `onion-architecture` (no server sites).
