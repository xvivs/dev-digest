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

- **A dialog stack must register on open in mount order, not effect order: when an inner dialog mounts in the same commit as its outer one, the child's effect runs first** — a naive push-on-effect stack would hand keyboard (Escape, Tab trap) to the OUTER dialog. `useDialogFocus` handles this in `pushDialog` (`client/src/vendor/ui/hooks/useDialogFocus.ts`); keep that ordering when adding another modal surface (e.g. the prompt Modal inside `RunTraceDrawer`). _(2026-09-28)_

- **A test that mocks `api.get` skips ADR 0007 response validation, so fixtures can drift from the contract and still pass; have the fake parse through the schema the hook hands it** — `h.get.mockImplementation((_p, schema) => Promise.resolve(schema ? schema.parse(data) : data))` (`client/src/app/skills/[id]/_components/SkillEditor/_components/StatsTab/StatsTab.test.tsx:90`). `VersionsTab.test.tsx` mocks `api.get` without this, despite its header claiming the schema is exercised. _(2026-09-29)_

- **Catch a polled query's running → terminal transition inside its `queryFn`, by comparing against `queryClient.getQueryData(key)`, not in a `useEffect` over `data.status`** — `useEvalSuite` (`client/src/lib/hooks/evals.ts:133`) invalidates stats, the skill and the list exactly once per transition, and needs no ref or effect. The catch is a suite that finishes before the first poll: nothing is cached to compare against. `useStartEvalSuite` therefore seeds the detail cache as `running` from the start response (`seedSuiteDetail`). _(2026-09-29)_

- **Keep transient scroll-driven UI state in the smallest subtree: the condensed-bar flag lives in `PrDetailHeader`, not `PrDetailContent`** — lifting it up re-rendered the whole diff on every toggle (284ms bar lag on a 100-file PR, per commit `4963d9f`); `useCondensedHeader` is called at `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:49`. _(2026-10-01)_

## What Doesn't Work

- **`IconBtn` is the wrong primitive for a row's trailing actions, and its `danger` prop has zero call sites** — `src/vendor/ui/primitives/IconBtn.tsx:36` already encodes exactly the hover colours a delete glyph wants (`danger && h ? var(--crit) : h ? var(--text-primary) : var(--text-secondary)`), which makes it look like the obvious reuse. It is not: it also forces a `size × size` box (default 30, vs ~19 for a bare 15px glyph) and its own `var(--bg-hover)` fill, both of which fight the "bare glyphs, no button chrome" rule the timeline row is built on. Meanwhile `grep -r '<IconBtn' src` shows the `danger` prop used nowhere, while four hand-rolled trash buttons sit at a static `var(--text-muted)` with no hover at all (`app/agents/_components/AgentCard/AgentCard.tsx:41`, `pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:117`, `vendor/ui/kit/Dropdown.tsx:35`). Read that prop as an unused sketch, not a convention — the timeline row uses a local `RunHistory/_components/RowAction/` that keeps the glyph bare and only swaps `color`. _(2026-09-20)_

- **A local `notify.error` in a mutation's `catch` doubles the toast, because `MutationCache.onError` already toasts every mutation error globally** — `client/src/lib/providers.tsx:41-43` calls `notify.error(errorMessage(err))` for every failed mutation, and `DiffTab.tsx:36-37`, `AddRepoView.tsx:36-37` and `SettingsApiKeys.tsx:47-48` catch the same `mutateAsync` rejection and toast again with their own copy. Nothing opts out of the global handler today (no `meta` flag), so adding a local error toast to a mutation is always a duplicate. Found by code reading during the 2026-09-28 audit, not yet reproduced in a browser; fix tracked as item 0.1 / decision D1 in `client/specs/frontend-audit/README.md`. _(2026-09-28)_

- **A stretched-link row (absolute `inset: 0` span inside the title `<a>`) breaks every e2e click on that link — `agent-browser find text|role … click` reports `✗ Element not found` and never navigates, while RTL tests and a manual DOM hit-test (`elementFromPoint` lands on the span, inside the link) are both fine** — reproduced with agent-browser 0.27.0 against `PRRow`; removing only the span made the same command pass. 6 of 10 flows failed on it (every flow that opens a PR by title). `PRRow` now keeps the title as a plain `next/link` (keyboard, middle-click) plus a mouse-only row `onClick` → `router.push`, skipping clicks inside `a, button` (`client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`). Don't reintroduce the overlay without re-running `./scripts/e2e.sh`. _(2026-09-28)_

- **Gating a response schema behind `process.env.NODE_ENV !== "production"` does NOT drop zod from the production bundle** — the contract modules call `z.object(...)` at module top level and the vendored folder has no `sideEffects: false`, so webpack keeps them whatever the call site does. Measured with `next build` (Next 15.5): +15 kB First Load JS on every route once `src/lib/hooks/skills.ts` imports schemas, and 227 kB vs 226 kB for `/skills` with the NODE_ENV-gated variant. Every route pays it because every page imports the `@/lib/hooks` barrel. Only a `sideEffects` declaration or keeping schema-using hooks out of the barrel would change that. _(2026-09-29)_

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

- **The server's `blockers` count is not "unresolved CRITICALs": it counts findings at or above the agent's `ci_fail_on`, ignores `dismissed_at`, and is frozen at run completion** — source: `reviewer-core/src/output/to-review.ts` (`countBlockers`). The client used to recompute `severity === "CRITICAL" && !f.dismissed_at` in `ReviewRunAccordion`, so the accordion and the timeline disagreed on the same run. The accordion now takes `runBlockers` from `RunSummary.blockers` and falls back to `countBlockers` in `client/src/lib/blockers.ts` only for reviews with no run. _(2026-09-28)_

- **The e2e flow matches the verdict badge by its lowercase source text, not what the user sees** — `e2e/specs/04-pr-findings.flow.json:15` waits for `"request changes"`, while `Badge` uppercases it via CSS (`client/src/vendor/ui/primitives/Badge.tsx:75`). Changing the verdict copy (e.g. to title case, or moving it to next-intl with different wording) breaks the browser suite without failing a single unit test. _(2026-09-28)_

- **`FEATURE_MODELS` has a third, client-local runtime copy; changing a default in both vendored `platform.ts` files leaves Settings → Models showing the old default** — the client may import only types from `vendor/shared`, so `client/src/lib/feature-models.ts:13` mirrors the registry by hand ("Keep this in sync" in its header); the `conventions` default stayed `openai/gpt-5.4` at `client/src/lib/feature-models.ts:46-47` after both vendor copies moved to `openrouter`/`deepseek/deepseek-v4-flash`. Change all three together. _(2026-09-29)_

- **`Modal` (`@devdigest/ui`) gives its body no padding; each caller's body style carries `padding: 24` to line up with the 24px header and footer** — `client/src/vendor/ui/kit/Modal.tsx:81` renders `{children}` in a bare scroll container, while `VetSkillModal/styles.ts:5` sets `body: { padding: 24 }`. A body without it sits flush against the dialog border. Tests stay green; only a browser shows it (the Evals modals shipped this way until `d3f8734`). _(2026-09-29)_

- **Nested sticky elements on the PR page need an offset and an opaque background, because `PrDetailHeader` is already `sticky; top: 0; z-index: 5` inside the scrolling `<main>`** — header at `src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/styles.ts:4-8`, scroll container `overflow: "auto"` at `src/vendor/ui/shell/AppFrame.tsx:33`. A second sticky at `top: 0` slides under the header. Smart Diff measures the header with `useStickyOffset` into the CSS var `PR_HEADER_OFFSET_VAR` (`pulls/[number]/constants.ts:3`) and reads it as `top: var(--pr-header-h, 0px)` (`SmartDiffGroup/styles.ts:8`). _(2026-10-01)_

- **Inside a `Disclosure`/`Collapse`, only the `headerStyle` row can be sticky — the body wrapper is permanently `overflow: hidden`** — `src/vendor/ui/primitives/Collapse.tsx:87` (documented at `:25`), which makes any sticky element in `children` stick to that clipped wrapper instead of the page scroller. Put the sticky style on the header row, not on content. _(2026-10-01)_

- **`@devdigest/ui`'s `Severity` type includes `"INFO"`, which finding data never has — type maps over findings with `FindingRecord["severity"]`** — `export type Severity = FindingSeverity | "INFO"` (`src/vendor/ui/primitives/tokens.ts:11`); a `Record<Severity, …>` over finding data forces a dead INFO key. _(2026-10-01)_

- **`DisclosureChevron` is a `ChevronDown` that rotates 180deg; the diff file cards use `ChevronRight` rotating 90deg — they are not interchangeable** — `src/vendor/ui/primitives/Disclosure.tsx:117-121` vs `src/components/diff-viewer/styles.ts:176` and `FileCard/FileCard.tsx:105` (Smart Diff copies the latter at `SmartDiffGroup/SmartDiffGroup.tsx:58`). Use the same glyph as the surrounding diff UI. _(2026-10-01)_

- **React Compiler is NOT enabled in the client, so memoization rules apply manually (stable props for memoized children, `useMemo` for expensive derivations), while trivial filters need no `useMemo`** — `client/next.config.mjs` has no `reactCompiler` option and `client/package.json` has no `babel-plugin-react-compiler`. _(2026-10-01)_

- **Exporting a value from `src/components/diff-viewer/index.ts` makes every consumer of a pure helper load the React/next-intl graph, including in vitest** — the barrel re-exports `DiffViewer` and `UnmatchedFindings` components next to the helpers `isActiveFinding`/`findingsForFile` (`index.ts:3-6`). Import pure helpers from their own file (`diff-viewer/findings.ts`) in logic code and tests. _(2026-10-01)_

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

- **The `vercel:react-best-practices` plugin skill (v0.50.0) recommends SWR, not TanStack Query, and its style `validate` hook never fires on this repo** — rule `rules/client-swr-dedup.md` ("Use SWR for Automatic Deduplication") contradicts the TanStack Query hooks in `client/src/lib/hooks/core.ts`; read it as "dedupe through a shared query key". Its frontmatter `validate` (SKILL.md:22-29) matches only `styled-components|@emotion/*|@mui/material|@chakra-ui/react` imports, so the inline-`CSSProperties` `styles.ts` convention (`client/src/app/agents/_components/AgentCard/styles.ts:4`, ADR `docs/adr/0003-collapse-in-vendored-ui.md`) is not flagged — do not "migrate to Tailwind/shadcn" on the plugin's advice. Checked in `~/.claude/plugins/cache/claude-plugins-official/vercel/0.50.0/skills/react-best-practices/`. _(2026-09-28)_

- **`fireEvent.keyDown(button, { key: "Enter" })` never clicks a native `<button>` under jsdom, so a keyboard test on a `Disclosure` header fails even though the browser works** — jsdom does not synthesise activation from Enter/Space, and `@testing-library/user-event` (which would) is not a dependency. The old hand-rolled `role="button"` headers passed because their own `onKeyDown` did the toggling; after the switch to `@devdigest/ui` `Disclosure` (a real `<button>`), `ReviewRunAccordion.test.tsx` had to assert the native button + `aria-expanded`/`aria-controls` and use `fireEvent.click` instead (`client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.test.tsx`). _(2026-09-28)_

- **A `NextIntlClientProvider` missing a whole namespace only logs `IntlError: MISSING_MESSAGE` — the test still passes** — observed in `client/src/test/smoke.test.tsx` (the DiffViewer case rendered with `messages={{ shell }}` after diff-viewer moved to its own `diffViewer` namespace): `vitest run` reported 60/60 files green while printing 7 `MISSING_MESSAGE: Could not resolve \`diffViewer\`` errors (next-intl 3.26, default `onError`). Grep the vitest output for `MISSING_MESSAGE` after any namespace move; a green run is not proof. _(2026-09-28)_

- **TanStack Query v5 fires a per-call `mutate(vars, { onSuccess, onError })` only for the dispatch its observer currently tracks; a superseded, still-in-flight dispatch never runs its per-call callbacks, while the hook-level `onSuccess` fires for every dispatch** — so a stale-response guard written in per-call options silently does nothing, and a slow older PUT can still win the cache write through the hook-level handler. Guard the hook-level `onSuccess` with a generation counter bumped in `onMutate` (`client/src/lib/hooks/agents.ts:133-140`). In tests under `vi.useFakeTimers()`, flush TanStack's notify scheduling with `await act(async () => { await vi.advanceTimersByTimeAsync(0) })`; looping `await Promise.resolve()` does not. _(2026-09-28)_

- **Under this repo's vitest + jsdom, `File.prototype.arrayBuffer` is missing, and `new Response(file).arrayBuffer()` "works" by stringifying the jsdom `File` to `"[object File]"` (cross-realm Blob, no error)** — a parser fed that looks like it got a corrupt upload. Read bytes with `file.arrayBuffer()` when present and fall back to `FileReader.readAsArrayBuffer`, which is same-realm and correct (`client/src/app/skills/_components/ImportSkillDrawer/helpers.ts:184-193`). Browsers always take the fast path; the fallback exists only for the test environment. _(2026-09-28)_

- **`beforeEach(() => mock.mockReset())` makes vitest call the mock with no arguments as a cleanup hook** — the arrow returns the mock function, and vitest treats a function returned from `beforeEach` as teardown; use a block body `beforeEach(() => { mock.mockReset(); })`. Cost time in `client/src/lib/hooks/agents.test.tsx`; `client/src/lib/query-client.test.ts:27` has the same shape, harmlessly. vitest 3. _(2026-09-29)_

- **next-intl `format.relativeTime(date)` without an explicit `now` logs `ENVIRONMENT_FALLBACK` in tests and client renders** — pass `format.relativeTime(date, new Date())` (or a `now` from `useNow`). Hit in the Conventions `ScanHeader` ("last scan X ago"), `client/src/app/repos/[repoId]/conventions/_components/ScanHeader/`. _(2026-09-29)_

- **`@testing-library/user-event` 14.6.7 is now a client devDependency: `userEvent.setup()` replaces `fireEvent` for hover, keyboard activation and clicks** — added in `client/package.json` (commit `20ae36e`); with fake timers use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, and `setup()` also installs a working `navigator.clipboard`. This supersedes the "user-event is not a dependency" workarounds in the `fireEvent.mouseEnter` and `fireEvent.keyDown` entries. _(2026-09-30)_

- **Under vitest fake timers, `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` hangs unless a `jest` global is stubbed** — RTL's asyncWrapper only advances fake timers when it sees `jest`; stub it with `vi.stubGlobal("jest", { advanceTimersByTime: ... })` as in `client/src/components/app-shell/AppShell.test.tsx:89-90`. _(2026-10-01)_

- **Anything in a `vendor/ui` Drawer `title` becomes part of the dialog's accessible name; mark decorative title content `aria-hidden` and assert names exactly (`{ name: "Navigation" }`, not a regex, which hid the bug)** — `client/src/vendor/ui/kit/Drawer.tsx:84` sets `aria-labelledby` to the title id; exact-name assertion at `client/src/components/app-shell/AppShell.test.tsx:43`. _(2026-10-01)_

- **The global `prefers-reduced-motion: reduce` rule shrinks every animation/transition duration to 0.01ms with `!important`, inline ones included, so a JS "reduced-motion fallback animation" never visibly plays — design reduced-motion branches as instant** — `client/src/vendor/ui/styles.css:411-417`; the Drawer's reduced fade (`DRAWER_FADE_MS`, `client/src/vendor/ui/kit/Drawer.tsx:7,60`) is overridden by it. _(2026-10-01)_

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

- **A `Modal` rendered inside a dimmed element (`opacity < 1`) comes out translucent, backdrop included, and its clicks bubble into the parent's handler** — `opacity` applies to the whole subtree and `position: fixed` does not escape it; the Review & trust modal sat inside a disabled `SkillCard` (`opacity: 0.6`), so the list showed through it. Render the modal as a sibling of the dimmed element, as `client/src/app/skills/_components/SkillCard/SkillCard.tsx:53-57` now does; unit tests cannot catch this, it only showed up in the browser. _(2026-09-28)_

- **Skill/finding markdown shows `#` headings and `-` bullets as plain same-size paragraphs with no markers — Tailwind 4 preflight, not react-markdown.** `@import "tailwindcss"` in `client/src/vendor/ui/styles.css` resets `h1–h6` font size/weight and `list-style`, so react-markdown's default elements lose all block styling; every block element needs an explicit renderer (`client/src/vendor/ui/primitives/Markdown.tsx:40-45`). A CSS rule cannot restyle inline-styled `code` inside `pre` (inline style wins), so the `pre` renderer emits the raw text itself. _(2026-09-28)_

- **`useRefreshRepo` resolves before the clone finishes, so a one-shot invalidation of `["repos"]` refetches `clone_path: null` and nothing refreshes it again** — the global `QueryClient` has `staleTime` 30 s and no focus refetch, so pages showed "not cloned / not synced" until a hard reload. Poll at the observer instead: `useRepos({ pollUntilCloned })` refetches every 3 s while the clone is pending (`client/src/lib/hooks/core.ts:78`). _(2026-09-30)_

- **Agent Skills tab dropped the first toggle: the response to a debounced PUT overwrote a newer pending edit, and a click before `["agent-skills"]` loaded was wiped by the fetch** — `SkillsTab.tsx` (autosave 400 ms) wrote the PUT response into the query cache and `latestRef` unconditionally, so a click made while the save was in flight vanished and the next debounce saved the stale list. Fix: when the debounce timer is armed, the response restores `latestRef` into the cache instead; rows do not render (`aria-busy`) until links load. Rule: a debounced mutation's response must not clobber a newer unsaved edit. `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx`. _(2026-09-30)_

- **Whole app frame scrolls up off-screen leaving a black area below (window scrolls, not `<main>`) = an unanchored `position: absolute` descendant escaped the `<main>` scroll container** — `<main>` is the app's only scroll container (`overflow: auto`); if it isn't positioned, absolute children (e.g. sr-only `<span role="status">` live regions, one per `EvidenceBlock` on /conventions) anchor to the initial containing block, bypass main's overflow and stretch `document.scrollHeight` (seen: 2397px vs 782px viewport). Diagnose with `document.documentElement.scrollHeight > innerHeight` + list `position:absolute` nodes whose bottom exceeds the viewport. Fix lives in the shell: `position: "relative"` on `<main>` in `client/src/vendor/ui/shell/AppFrame.tsx:33` — don't remove it; overlays stay safe because Modal/Drawer wrap themselves in `position: fixed`. _(2026-09-30)_

- **Value imports of `@devdigest/shared` contract schemas now work in `next dev` and `next build`, because `client/next.config.mjs` sets `resolve.extensionAlias` `.js → [.ts, .tsx, .js]`** — the barrel's NodeNext `.js` specifiers used to 500 every route (see the older "Module not found … contracts/findings.js" entry, which this supersedes). Verified with `next build` and a live `next dev` render of `/skills/sk1?tab=versions`, where `src/lib/hooks/skills.ts:8` value-imports `SkillVersion`/`RestoreSkillVersionResult` from `@devdigest/shared/contracts/skill-impact`. Import the contract subpath, not the barrel, to keep the bundle to what you use. _(2026-09-29)_

- **`screen.getByRole("status")` throws "multiple elements" in any test that wraps `<ToastProvider>`, because the toast host is itself a `role="status"` live region** (`client/src/lib/toast.tsx`). Query the text and assert the role on it instead: `expect(screen.getByText(/^Draft from v2\./)).toHaveAttribute("role", "status")` (`client/src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.test.tsx`). _(2026-09-29)_

- **`tsc` fails with TS2742 "The inferred type of 's' cannot be named without a reference to '.pnpm/csstype@…'" when a `styles.ts` object spreads a `const cell: CSSProperties = {…}` into its `satisfies CSSProperties` entries** — the widened annotation leaks csstype's union types into the exported `s`. Declare the shared piece `as const satisfies CSSProperties` instead (`client/src/app/skills/[id]/_components/SkillEditor/_components/StatsTab/styles.ts:3`). _(2026-09-29)_

- **In a working tree shared with a concurrent agent, `git rm <path>` stages the deletion right away, and a later `git add <other paths> && git commit` ships it with those files, even though you never named it** — `git commit` with no pathspec commits the whole index. That is how the PlaceholderTab deletion landed in the helpers refactor `4bd3ad0`, a commit whose `SkillEditor.tsx` still imports that component. Delete with plain `rm`, stage the deletion only in the commit that removes its last import, and run `git diff --cached --stat` before every commit. _(2026-09-29)_

- **A merge that pairs this branch's `Tabs` (`role="tab"`, `client/src/vendor/ui/kit/Tabs.tsx`) with tests written on `main` fails them with `Unable to find an accessible element with the role "button" and name "…"`** — main's tests still query tab switches as buttons (`SkillEditorView.test.tsx`, `EvalsTab.test.tsx`); the component is fine, only the query needs `getByRole("tab", …)`. Also re-check client mirrors of server rules after such a merge: `restoreResetsVetting` (`VersionsTab/_components/RestoreVersionModal/helpers.ts:11`) had main's `imported`-only rule while the server resets `extracted` too (`server/src/modules/skills/domain.ts:234`), and no unit test caught it — only `skills-versions.it.test.ts`. _(2026-09-30)_

- **Returning focus to a trigger after a `vendor/ui` Drawer closes: a synchronous `focus()` in the close handler loses, and `queueMicrotask` can too — use `requestAnimationFrame` plus an explicit trigger ref** — `useDialogFocus` restores focus in an effect cleanup (`client/src/vendor/ui/hooks/useDialogFocus.ts:146-150`) that runs after the close handler, and Safari never focuses buttons on click, so its remembered opener is empty there. Fix in `client/src/components/app-shell/AppShell.tsx:49-52` (`closeNav`, `navTriggerRef`). _(2026-10-01)_

- **A sticky header that shrinks in flow inside the scroll container triggers browser scroll anchoring, and JS scroll compensation wobbles because it lags a frame — use the condensing pattern** — commit `8259f38` replaced the collapsing header (`6df5a33`) with a static full header plus a fixed-height bar in a zero-height sticky anchor (`PrDetailHeader/_components/CondensedBar/styles.ts:10-15`), and sets `overflow-anchor: none` on `<main>` as a guard (`PrDetailHeader/hooks/useCondensedHeader.ts:30-31`, under `client/src/app/repos/[repoId]/pulls/[number]/_components/`). Flow height never changes, so nothing is left to compensate. _(2026-10-01)_

- **Measurements gated on `transitionrun` race a ResizeObserver: the event fires in the frame after the style change, while the ResizeObserver callback fires in the same frame** — seen in `useStickyOffset` (`.../PrDetailView/_components/PrDetailContent/hooks/useStickyOffset.ts:54` at commit `6df5a33`, code later removed — open it with `git show 6df5a33:<path>`). Don't gate layout reads on transition events. _(2026-10-01)_

- **CSS grid `repeat(auto-fill, minmax(280px, 1fr))` overflows containers narrower than 280px — write `minmax(min(280px, 100%), 1fr)`** — fixed in `CARD_GRID_COLS` at `client/src/app/agents/_components/AgentsListView/constants.ts:7`. _(2026-10-01)_

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

### 2026-09-28 — client session
Renamed `client/CLAUDE.md` to `AGENTS.md` and added a one-line `@AGENTS.md` stub `CLAUDE.md` next to it, per ADR 0004. Edit rules in `AGENTS.md` only; the content itself did not change.

### 2026-09-28 — client session
Audited `client/src` through four lenses (frontend-architecture, react-best-practices, next-best-practices + typescript/zod, react-testing-library + security) with parallel subagents. Shipped no code, only the plan `client/specs/frontend-audit/README.md` with the raw reports in `raw/`: 6 waves plus 6 decisions (D1–D6) awaiting ADRs. Baseline: `tsc --noEmit` exit 0, vitest 19 files / 102 tests green. Two auditor CRITICALs were re-graded (NEXT-1 → HIGH, NEXT-5 → MEDIUM); the reasoning is in the plan.

### 2026-09-28 — client session (plan execution)
Executed all 6 waves of `client/specs/frontend-audit/README.md` with 8 Opus subagents on disjoint file sets (phase A: lib, @devdigest/ui, app boundaries; phase B: five screens), then integrated. Result: tsc 0, vitest 60 files / 360 tests (from 19 / 102), `next build` green, every page.tsx a thin Server Component with metadata, ADRs 0007–0011 added. Not done: e2e and browser checks (Docker daemon down), D2 schema wiring (blocked by `.js` imports in vendor/shared), react-markdown chunk loaded on every route (measured, not fixed).

### 2026-09-28 — client session (SPEC-02 Skills)
Shipped `/skills` (list, Config/Preview, placeholder tabs, trust modal), the agent Skills tab with coalesced autosave, `.md`/`.zip` import on fflate, and skills tokens in the trace. Browser checks caught three bugs the tests missed (translucent vet modal, "1 agents", slug title wrapping), and review caught two more (name link bypassing the dirty guard, stale draft after vetting). Known gap: sidebar/breadcrumb links are not dirty-guarded.

### 2026-09-29 — client session (skill Versions, Phase 1)
Built the skill version hooks with contract response schemas and a Versions tab. It has a list with gaps for lost history, an inline jsdiff diff (lazy-loaded) and an Edit / Restore / Cancel popup. ConfigTab can open a snapshot as a draft through `?fromVersion=N` and has a "What changed" note. The server half was built in parallel by another agent. The browser pass ran against an in-memory mock API, because running migrations would have applied that agent's in-progress 0017 migration.

### 2026-09-29 — client session (skill Stats, Phase 2)
Added `useSkillStats(id, window)` (key `['skill-stats', id, window]`, `keepPreviousData`), the Stats tab (7d/30d/90d in `?window=`, Impact, Usage, Cost, By version) and the skill card's "N agents · M runs · verdict" line with a shared `VerdictBadge`. Browser-checked against a mock API on :3199, not the real server, because the other agent's 0018/0019 eval migrations were uncommitted in the tree. Sparkline and BarRow are unused: the contract has no time series, and by-version rows carry a cost that BarRow's string suffix cannot render with provenance.

### 2026-09-29 — client session (skill Evals tab, Phase 3)
Built the Evals tab. It shows the latest started suite's verdict and results line, or live progress with Cancel; case rows show both arms with outcome and unexpected badges. The Run modal takes carrier and mode, gives the estimate ($ and call count), then Start, and shows the trust gate as "vet skill first". The case editor accepts a pasted diff or a PR's files, plus must_find / must_not_find rows. The header "Run on evals" button now works. Checked only against a mock API in the browser, because the server eval routes were still being built. Per-case runs are not built: `CreateEvalSuiteBody` has no case subset.

### 2026-09-30 — client session
Shipped the Overview tab (brief, intent, risks, blast radius, prior PRs), the Settings auto-brief toggle and the mobile nav drawer (ADR 0024). Desktop is the supported target; narrow-width gaps are tracked in #10.

## Open Questions

- **Conflict: does a `NextIntlClientProvider` missing a namespace throw or only log?** — the Recurring Errors entry dated 2026-09-19 says a single-namespace provider "throws on the first missing message", the Tool & Library entry dated 2026-09-28 observed only a logged `MISSING_MESSAGE` with a passing test (`client/src/test/smoke.test.tsx`). Possibly both true (missing key vs missing namespace, or a custom `onError`); needs a human to reconcile. _(2026-09-28)_

- **Conflict: the `fireEvent.mouseEnter` (2026-09-20) and `fireEvent.keyDown` Recurring Errors entries say `@testing-library/user-event` is not a dependency; it now is (`client/package.json`, 2026-09-30 Tool & Library entry).** Their jsdom explanations still hold, but the "use fireEvent/relatedTarget instead" advice is stale; reconcile during cleanup. _(2026-09-30)_

- **The Recurring Errors entry "Module not found … contracts/findings.js" (2026-09-20) says to keep `import type` and re-derive runtime values. The 2026-09-29 extensionAlias entry supersedes that advice.** Prune the older entry in the next cleanup (`client/next.config.mjs`). _(2026-09-29)_
