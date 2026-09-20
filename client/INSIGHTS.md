# INSIGHTS — client

Append-only journal of things that cost us time in `@devdigest/web`. Write here
**first** and without a filter: an entry is cheap, a line in `CLAUDE.md` is not.

Findings that cross package boundaries go in the repo-root `../INSIGHTS.md`.

Priority: anything that surprised you, broke in a non-obvious way, or where the
obvious fix turned out to be wrong.

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly cleanup —
lives in the engineering-insights skill).

## What Works

- A cross-route presentational component (used on 3+ screens with different
  typography contexts) stays a bare `<span style={style}>` with **no own**
  `fontSize`/`color`/`padding` — it inherits the caller's typography instead of
  imposing its own. `RunCostValue` (`src/components/run-cost-value/`) is the
  precedent: identical component renders correctly in an 11px timeline row
  (`RunHistory.tsx`), a 16px sidebar `Stat` card (`TraceBody.tsx`), and a table
  cell (`PRRow.tsx`), with the call site owning all layout/typography via an
  optional `style?: CSSProperties` passthrough (mirrors `Badge.tsx`). _(2026-09-19)_

- Two controls that filter the same list must be tallied from ONE array, or
  their numbers drift. `FindingsPanel` splits `helpers.ts` into
  `baseFindings(findings, {hideLow})` (confidence gate + severity sort) and
  `bySeverity(base, severity)`; the counter pills are tallied from `base` —
  after hideLow, before the severity filter — so "2 WARNING" is a promise that
  selecting Warning renders exactly two cards. Tallying from the raw `findings`
  prop instead over-reports the moment hideLow is on. _(2026-09-20)_
- Prop → state sync done by **adjusting state during render** (`if (nonce !==
  prevNonce) { setPrevNonce(nonce); setSeverity(target) }`) beats both
  alternatives for a "jump here and pre-filter" hand-off: `useEffect` paints one
  frame of the unfiltered list first, and a `key` remount throws away the
  sibling state the user set (hideLow, keyboard focus index). Same pattern seeds
  `FindingsTab`'s `?severity=` target on the render the async reviews first
  arrive on. (`src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:45-48`) _(2026-09-20)_

- **Animate a disclosure with `grid-template-rows: 0fr → 1fr`, never `height` or `max-height`** — `height: auto` does not interpolate without `interpolate-size: allow-keywords` (not Baseline yet), and `max-height` needs a guessed ceiling that breaks the moment the body holds Markdown or a nested panel — which every collapsible body here does. The keyframes live in `client/src/vendor/ui/styles.css:277-296` and the two-node structure that makes them work (`display: grid` outside, `min-height: 0; overflow: hidden` inside — without `min-height: 0` the 0fr track floors at min-content) is in `client/src/vendor/ui/primitives/Collapse.tsx:74-88`. No JS ever measures a node. _(2026-09-20)_

## What Doesn't Work

- **`IconBtn` is the wrong primitive for a row's trailing actions, and its `danger` prop has zero call sites** — `src/vendor/ui/primitives/IconBtn.tsx:36` already encodes exactly the hover colours a delete glyph wants (`danger && h ? var(--crit) : h ? var(--text-primary) : var(--text-secondary)`), which makes it look like the obvious reuse. It is not: it also forces a `size × size` box (default 30, vs ~19 for a bare 15px glyph) and its own `var(--bg-hover)` fill, both of which fight the "bare glyphs, no button chrome" rule the timeline row is built on. Meanwhile `grep -r '<IconBtn' src` shows the `danger` prop used nowhere, while four hand-rolled trash buttons sit at a static `var(--text-muted)` with no hover at all (`app/agents/_components/AgentCard/AgentCard.tsx:41`, `pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:117`, `vendor/ui/kit/Dropdown.tsx:35`). Read that prop as an unused sketch, not a convention — the timeline row uses a local `RunHistory/_components/RowAction/` that keeps the glyph bare and only swaps `color`. _(2026-09-20)_

## Codebase Patterns

- Dynamic i18n key lookup — `t(\`namespace.${variable}\`)` — is an established,
  working pattern in this codebase, not a hack. Precedent:
  `t(\`runStatus.${o.key}\`)` in `RunHistory.tsx`. Used again in
  `RunCostValue.tsx` for `t(\`missing.${reason}\`)` to map a `cost_missing_reason`
  enum value straight to its tooltip copy without a switch statement. _(2026-09-19)_
- A new cross-route namespace (rendered from components used on multiple
  screens, e.g. inside both `prReview` and `runs` namespaced trees) can't
  borrow either screen's namespace — it needs its own
  `messages/en/<namespace>.json` file. `cost.json` was added for this reason:
  `RunCostValue` renders inside `RunHistory` (namespace `prReview`), `TraceBody`
  (namespace `runs`), and `PRRow` (namespace `prReview`), so a shared
  `cost` namespace was the only option that didn't create a false coupling
  between `prReview` and `runs`. _(2026-09-19)_

- A nonce prop (`targetNonce`, bumped on every click) is how this codebase
  re-triggers an idempotent hand-off — asking for the SAME severity or the same
  run twice still fires. Precedent: `ReviewRunAccordion`'s scroll-into-view;
  reused verbatim for the Timeline → `FindingsPanel` severity filter
  (`src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:52-56`). _(2026-09-20)_
- Cross-component gates should key on the row identity that always exists.
  `ReviewRunAccordion` used to gate on `review.run_id === targetRunId`, but
  reviews with a null `run_id` exist on a real database and could never be
  targeted; it now gates on `review.id === targetReviewId`, with the tab
  resolving `run_id → review id` through a memoised map
  (`src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:52`). _(2026-09-20)_
- `@devdigest/ui`'s `Chip` supports neither `disabled` nor `aria-pressed`
  (`src/vendor/ui/primitives/Chip.tsx`), and `vendor/**` is do-not-touch. A
  filter row that needs either is a local `<button type="button">` styled to
  match `Chip`, taking its colours from `SEV` in
  `vendor/ui/primitives/tokens.ts` — see
  `pulls/[number]/_components/SeverityFilterBar/`. _(2026-09-20)_
- Derive-don't-store applies to list indices too: the severity filter can shrink
  the list under a stale `focusIdx`, so `FindingsPanel` clamps on read
  (`Math.min(focusIdx, shown.length - 1)`) instead of keeping a corrected copy
  in state (`src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:60`). _(2026-09-20)_

- **`FindingsPopover` learns which severity chip is hovered by DOM event delegation (`data-severity`), not by a prop or context — and that is load-bearing, not a shortcut** — `SeverityIcons` is `React.memo` precisely because the PR list re-polls every 60s (`client/src/components/severity-icons/SeverityIcons.tsx:86-87`); a new callback prop would need a `useCallback` at every call site, and a context consumer would re-render on every pointer move. Instead each chip carries `data-severity` (`SeverityIcons.tsx:71,80`) and the popover reads `e.target.closest("[data-severity]")` inside handlers it already had (`client/src/components/findings-popover/FindingsPopover.tsx:82-86`). This only works because the popover listens on `onMouseOver`/`onFocus`, which bubble — `onMouseEnter` would not. Validate the attribute with the exported `isSeverity` guard; it is DOM state, not a typed value. _(2026-09-20)_

## Tool & Library Notes

- In this worktree, `pnpm typecheck` / `pnpm test` / any `pnpm exec …` first
  runs pnpm's dependency-status preflight, which itself calls `pnpm install`
  and fails here with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts:
  esbuild@0.21.5, sharp@0.34.5` (needs `pnpm approve-builds`, not run in this
  session). `node_modules` is otherwise complete and correct. Workaround:
  invoke the binaries directly, bypassing pnpm's wrapper —
  `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/vitest run`.
  Both produced clean results once called this way. _(2026-09-19)_

- **`fireEvent.mouseEnter` never reaches an `onMouseEnter` handler under React 19** — React synthesises enter/leave from delegated `mouseover`/`mouseout`, and `mouseenter` does not bubble, so it never reaches the root delegate. A hover test written with it passes while asserting nothing. Use `fireEvent.mouseOver(el)` / `fireEvent.mouseOut(el, { relatedTarget: document.body })`. `fireEvent.focus`/`blur` DO work. `@testing-library/user-event` is not a dependency here, so `userEvent.hover` is not an option. _(2026-09-20)_

- **jsdom implements neither `Element.getAnimations()` nor `animationend`, so an exit animation that unmounts on `onAnimationEnd` leaves the node in the DOM forever under vitest** — `Collapse` waits on `ref.current?.getAnimations?.() ?? []` and treats the empty list as "already finished" (`client/src/vendor/ui/primitives/Collapse.tsx:54-66`), which makes the unmount synchronous in jsdom and keeps the DOM contract identical to a plain `{open && …}`. An `animationend` listener would simply never fire there, and every existing test asserting that a collapsed body is gone would have started passing for the wrong reason or hanging. Verified in Chrome: unmount lands at ~210ms for an OUT_MS of 180. _(2026-09-20)_

- **`lucide-react` 0.469 draws `Activity` as a smoothed `<path>`, not the sharp polyline the ported design uses** — the glyph was redrawn upstream (`node_modules/lucide-react/dist/esm/icons/activity.js` ships `d="M22 12h-2.48a2 2 0 0 0-1.93 1.46…"`), so the TIMELINE `SectionLabel` rendered a different shape than the design it was ported from, and nothing in the app hinted why. `src/vendor/ui/icons.tsx` now pins the registry entry: `createLucideIcon("Activity", [["polyline", { points: "22 12 18 12 15 21 9 3 6 12 2 12" }]])` wrapped in a `React.forwardRef` that defaults `strokeWidth` to 1.75. The wrapper is load-bearing — `createLucideIcon` exposes no way to override lucide's `defaultAttributes`, and neither `kit/Tabs.tsx:41` nor `primitives/SectionLabel.tsx:15` forwards a `strokeWidth` of its own. Any registry name can be pinned the same way, and a lucide bump can no longer change it silently. _(2026-09-20)_

## Recurring Errors & Fixes

- Every RTL test that renders a component tree containing a cross-route leaf
  (`RunHistory`, `TraceBody` inside `RunTraceDrawer`, `PRRow`) must merge in
  that leaf's own i18n namespace on top of the screen's namespace, e.g.
  `messages={{ prReview: messages, cost: costMessages }}` — a single-namespace
  `NextIntlClientProvider` throws on the first missing message the moment the
  leaf renders. `RunHistory.test.tsx` and `RunTraceDrawer.test.tsx` both needed
  this update after `RunCostValue` (namespace `cost`) was added to their trees. _(2026-09-19)_

- Passing per-row callbacks or freshly built objects into a `React.memo` child
  from inside a `.map()` silently voids the memo. `RunHistory` takes both the
  severity tally (`countsByRun`) and the run→review lookup as ready maps from
  `FindingsTab`, and builds its per-run `onSelect` closures in a `useMemo` keyed
  on `[countsByRun, onGoToReview]` — a `(sev) => onGoToReview(r.run_id, sev)`
  written inline would have been just as fatal to `SeverityIcons` as an inline
  `countBySeverity(...)` (`src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:138`). _(2026-09-20)_
- Optional lookup-map props need a MODULE-level empty default
  (`const EMPTY_MAP: ReadonlyMap<string, never> = new Map<string, never>()`).
  Two gotchas: a `new Map()` in the default parameter is a new object every
  render, and a bare `new Map()` infers `Map<any, any>`, which will not satisfy
  a `ReadonlyMap<string, never>` annotation (`forEach` is contravariant on the
  callback's value) — annotate the constructor, not just the constant
  (`src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:88`). _(2026-09-20)_

- **`Module not found: Can't resolve './contracts/findings.js'` from `src/vendor/shared/index.ts` means someone added a VALUE import of `@devdigest/shared` on the client** — the vendored barrel re-exports with explicit `.js` specifiers and `next.config.mjs` sets no `extensionAlias`, so webpack cannot map them back to `.ts`. This never fires because every other client import of that barrel is `import type`, which the compiler erases before webpack sees it. The failure mode is nasty: `tsc --noEmit` and the whole vitest suite stay green (vite resolves the specifier fine) while the route 500s at request time. Fix: keep `import type` and re-derive the runtime value locally — `pulls/[number]/page.tsx` validates `?severity=` against a local `as const` tuple instead of calling `Severity.safeParse` from the contract. _(2026-09-20)_

- **The toast `Cannot reach the DevDigest engine at http://localhost:3101` while `curl http://localhost:3001/repos` returns data means the web dev server is serving a stale `NEXT_PUBLIC_API_BASE`, not that the API is down.** `NEXT_PUBLIC_*` is inlined into the client bundle when `next dev` boots, so fixing `client/.env` (`NEXT_PUBLIC_API_BASE=http://localhost:3001`) does nothing until the web process restarts — confirmed by `lsof -p <pid> -a -d cwd` showing the `next-server` on :3000 running from this worktree's `client/` while the port in the toast was the pre-fix one. When another session owns :3000 and restarting it is not an option, navigate with a Chrome-DevTools `initScript` that patches `window.fetch` and `window.EventSource` to rewrite the stale host — it leaves the process untouched and the app renders real data. _(2026-09-20)_

- **A PR timeline row that shows only `· N blockers` and no severity chips is a `run_id` join miss, not a styling bug.** `FindingsTab` keys `countsByRun` by `review.run_id` (`src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:90`), `RunHistory` reads `countsByRun.get(r.run_id) ?? ZERO_COUNTS`, and `SeverityIcons` returns `null` for an all-zero tally (`src/components/severity-icons/SeverityIcons.tsx:42`) — so a review whose `run_id` matches no row in `prRuns` renders nothing at all, with no element and no `aria-label` left on the page to grep for. Seeded PR #482 of `acme/payments-api` shows it: the Review runs section reports `1 CRITICAL · 1 WARNING` while the timeline row above it has no chips. Check the join before touching any CSS. _(2026-09-20)_

- **"+N more" in the findings popover counted against a number from a different source than the list it summarised** — `total` reaches the panel from the severity tally (`PrMeta.last_review_findings` on the list, `r.findings_count` in the timeline), while the previewed rows come from `GET /pulls/:id/reviews`; the two are computed independently and the comment at `client/src/app/repos/[repoId]/pulls/_components/PrFindingsCell/PrFindingsCell.tsx:42-46` already warned they can disagree. Fixed by counting from the loaded findings once the panel is scoped (`client/src/components/findings-popover/FindingsPopover.tsx:287-291`), which is safe there because the `error`/`loading`/`undefined` guards above it have already proven they arrived. When a component holds two numbers for the same thing, prefer the one derived from what is actually on screen. _(2026-09-20)_

- **"No trace available yet." in the Agent-run drawer means a missing `run_traces` row, never a broken trigger** — `useRunTrace` sets `retry: false` (`src/lib/hooks/trace.ts:17`), so a 404 from `GET /runs/:id/trace` settles as `data === undefined, isLoading === false`, and `RunTraceDrawer.tsx` falls through to that single line with no error surface to tell it apart from a genuinely empty trace. The drawer has no early `return null` either, so "it opened but it is blank" is always a data gap, not a wiring one — do not go looking at whatever opened it. Check the row directly (`select run_id from run_traces`) against the `run_id` in the `?trace=` query param before touching any client code. _(2026-09-20)_

## Session Notes

- Cost Badge (L01, client half): added `RunCostValue` + `formatCost`/`exactCost`
  (`src/components/run-cost-value/`) and wired it into the PR timeline
  (`RunHistory.tsx`, with a new `formatTokenTotal` in its own `helpers.ts`), the
  run trace sidebar (`TraceBody.tsx`, 4th `Stat` card), and the PR list table
  (new `cost` column between STATUS and UPDATED — `constants.ts`, `styles.ts`,
  `page.tsx`, `PRRow.tsx`). The server/reviewer-core/contracts half of this
  feature was built in parallel by another agent in the same worktree; by the
  time this work finished, `contracts/cost.ts` and the `cost_usd` /
  `cost_source` / `cost_missing_reason` fields on `RunSummary`, `RunStats`, and
  `PrMeta` were already present in both vendored `shared` copies, so
  `pnpm typecheck` and `pnpm test` were both clean end to end — no landing gap
  to work around this time. _(2026-09-19)_

- Severity filters on the PR page (L01, client half): added
  `pulls/[number]/_components/SeverityFilterBar/` (tally row + always-visible
  Critical/Warning/Suggestion filter buttons, zero-count levels disabled), split
  `FindingsPanel/helpers.ts` into `baseFindings` + `bySeverity`, renamed
  `ReviewRunAccordion`'s `targetRunId` → `targetReviewId`, and turned
  `FindingsTab`'s `target` into `{ reviewId, severity, n }` fed by three
  memoised maps. `RunHistory`'s "N finding(s)" text was replaced by
  `SeverityIcons` inside a `FindingsPopover`; `· N blockers` stayed. The
  cross-route `severity-icons` / `findings-popover` components were written by
  another agent in the same worktree and had landed by the time this half was
  wired, so no mocks were needed. Full client suite: 18 files / 85 tests green,
  `tsc --noEmit` clean. _(2026-09-20)_
### 2026-09-20 — FINDINGS feature (client) session
Shipped the severity surface: a shared `severity-icons` + `findings-popover` pair under `src/components/`, a `PrFindingsCell` FINDINGS column between SCORE and STATUS on the PR list, and the tally/filter row inside `FindingsPanel`. Hover previews load lazily off the existing `usePrReviews` cache, so the 60s-polled list ships counts only. Verified in a real browser against a throwaway seeded DB — which is the only reason the vendored-barrel value-import 500 (see Recurring Errors & Fixes) was caught at all; typecheck and 85 vitest tests were green the whole time it was broken. Two loose ends from the parallel agents were closed here: the unconsumed `prReview.timeline.goToSeverity` key was removed (`SeverityIcons` owns its own `aria-label`), and the `borderColor`/`borderLeftColor` React warning in `FindingCard/styles.ts` was fixed by going all-longhand per side.

### 2026-09-20 — animated disclosure + severity-scoped popover session
Added `Collapse` to `@devdigest/ui` (`primitives/Collapse.tsx`) and routed all four collapsible regions through it — `ReviewRunAccordion`, `FindingCard`, `TraceSection`, `ToolCallRow` — which also closed an accessibility gap: every trigger now carries `aria-expanded`/`aria-controls`, and three that were bare `div`s gained `role="button"` plus Enter/Space. `FindingsPopover` now scopes its preview to the severity chip under the cursor via `data-severity` delegation, with new ICU keys `popover.titleRunSeverity`/`titleReviewSeverity`. Landing this in `vendor/ui` is a deliberate break from the old blanket "do not touch vendor" rule, recorded in `docs/adr/0003-collapse-in-vendored-ui.md` and reflected in both `CLAUDE.md` files. Verified: `tsc --noEmit` clean, vitest 96/96 (up from 85; `ReviewRunAccordion` had no test at all before), browser-checked in Chrome, and e2e 10/10. Left undone: `ToolCallRow` is unreachable from the browser because every seeded trace carries `tool_calls: []`, so it rests on unit tests only.

### 2026-09-20 — Agent-runs timeline polish (client) session
Brought the TIMELINE row in the Agent-runs tab back in line with the design: the whole panel now opens the trace drawer (agent name, severity chips and both `RowAction` glyphs stop propagation, and the row stays a `<div>` because it nests buttons — the `Open run trace & logs` button is what keeps a keyboard path in), the row lifts to `var(--bg-hover)` on hover, tokens/cost moved up to `var(--text-secondary)` while the timestamp stayed `var(--text-muted)`, and the two trailing glyphs gained hover colours through a new `RunHistory/_components/RowAction/`. The Agent-runs tab icon moved off `AlertOctagon` onto a pinned pre-redraw `Activity`. Six new tests in `RunHistory.test.tsx` cover click routing and both hover states; suite is 19 files / 102 tests green.

## Open Questions
