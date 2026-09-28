# Client audit — improvement plan (2026-09-28)

Audit of `client/src` (~200 files, ~13.6k LOC, excluding `vendor/shared`) through four lenses,
each checked against a project skill:

| Lens | Skill | Raw report |
|---|---|---|
| Architecture / layering / i18n / styles | `frontend-architecture` | [raw/audit-architecture.md](raw/audit-architecture.md) |
| React 19 correctness, perf, a11y | `react-best-practices` (+ `vercel:react-best-practices`) | [raw/audit-react.md](raw/audit-react.md) |
| Next 15 App Router, TypeScript, zod | `next-best-practices`, `typescript-expert`, `zod` | [raw/audit-next-ts.md](raw/audit-next-ts.md) |
| Tests + client security | `react-testing-library`, `security` | [raw/audit-tests-security.md](raw/audit-tests-security.md) |

Finding IDs (`ARCH-n`, `REACT-n`, `NEXT-n`, `TS-n`, `TEST-n`, `SEC-n`) point to rows in the raw reports.

## Execution status (2026-09-28)

All six waves were executed the same day, uncommitted, by 8 chunk agents working on disjoint file sets. An adversarial review pass followed.

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| vitest | 19 files / 102 tests | 60 files / 364 tests |
| `next build` | not run | green; every `page.tsx` is a ≤22-line Server Component with `generateMetadata` |
| e2e (`./scripts/e2e.sh`, hermetic) | — | **10/10 flows pass**. The first run was 4/10: the PRRow stretched-link overlay broke agent-browser clicks, so it was replaced by a title link plus a row `onClick`. `04`/`09` selectors are scoped to `[data-disclosure]`. Run with `pnpm_config_verify_deps_before_run=false` (see root INSIGHTS). |

Decisions taken: D1 → ADR 0011, D2 → ADR 0007, D3 → ADR 0008, D4 → ADR 0009 (hand-rolled `useDialogFocus`, not native `<dialog>`), D5 → ADR 0010, D6 → `labelKey`.

**Still open:**
- **D2 wiring.** The schemas are not wired: value-importing `@devdigest/shared` contracts with `.js` sibling imports 500s `next dev`. It needs webpack `extensionAlias` plus a browser check.
- **4.5 bundle.** Measured: the `react-markdown`/micromark chunk (~170 kB raw) loads on **every** route, including `/` and settings. The likely path is the `@devdigest/ui` barrel. Lazy-loading `Markdown` changes render timing in tests, so it needs its own PR.
- **Pre-existing bug.** Toggling an agent in the list doesn't reset an open `ConfigTab` draft for the same id, so Save can write a stale `enabled` value back.
- **Leftovers.**
  - `lib/toast.tsx` inline styles.
  - The untranslated "WORKSPACE" nav group (`NavGroup` has no key).
  - English fallbacks in `vendor/ui/shell/RepoSwitcher.tsx:73`.
  - Tests import `messages/*.json` through deep relative paths, since there is no alias for them.
- **Visual changes to check by eye.**
  - Timeline timestamps now show date and time.
  - The trash glyph now has a hover colour.
  - The agent search icon moved to the right (`TextInput` suffix).
  - In `PromptBlock`, the expand label now sits left of the copy buttons.
  - Clicking the `FindingCard` meta row no longer toggles the card.
  - Clicking the PR-row cost value doesn't navigate.

**Baseline:** `./node_modules/.bin/tsc --noEmit` → exit 0; `./node_modules/.bin/vitest run` →
19 files / 102 tests pass (`pnpm typecheck|test` fails at pnpm's preflight in this worktree, see INSIGHTS).

## Summary

| Lens | CRIT | HIGH | MED | LOW |
|---|---|---|---|---|
| Architecture | 0 | 12 | 31 | — |
| React / a11y | 1 | 6 | 4 | 2 |
| Next / TS | 0* | 6* | 8 | 6 |
| Security | 0 | 0 | 0 | 1 |

\* Two Next findings were re-graded during synthesis:
- `NEXT-1` (no `error.tsx`): CRITICAL → **HIGH**. Real gap (an uncaught render error blanks the whole app), but nothing is broken today.
- `NEXT-5` (`useSearchParams` without local Suspense): CRITICAL → **MEDIUM**. The root `<Suspense fallback={null}>` in `app/layout.tsx:29` satisfies Next's build requirement; the actual cost is that the whole app has one boundary with an empty fallback.

**Holding up well:**
- Layering. `fetch` appears only in `lib/api.ts`, no hook returns JSX, no component is defined inside another, and no route imports a sibling route's `_components`.
- Security. There is no `rehype-raw` and the only `dangerouslySetInnerHTML` is a static theme script. Mermaid runs with `securityLevel: "strict"`, and API keys never reach storage or logs.
- The newer L01 code (FindingsPanel, SeverityFilterBar, RunCostValue) already follows every convention and is the template for the fixes below.
- Heavy dependencies: `mermaid` is already loaded through dynamic `import()`.

**Systemic problems** (each shows up in 3 or more places):
1. **Thick routes.** 4 of 7 `page.tsx` files hold state, invalidation and branching (ARCH-1, 3, 4, 13).
2. **Duplicated domain lookups have drifted.** One verdict renders in two colours on one screen (ARCH-9), SUGGESTION uses `--accent` in one place and `--sugg` in another (ARCH-10), and there are three severity orders, three `lineLabel` copies, two blocker definitions (ARCH-8) and two `formatWhen` copies.
3. **Older "ported" files ignore conventions.** They inline English copy, carry about 110 `style={{}}` blocks, lack `index.ts`, and account for 61 deep `../../../../` imports where the `@/` alias already exists.
4. **Keyboard access.** Primary navigation uses clickable `<div>`s with no keyboard path (PRRow, AgentCard, SearchableSelect, PromptBlock, the API-key reveal toggle), and Modal/Drawer have no dialog semantics.
5. **The API boundary is unchecked.** `api.ts:62` casts every response `as T`, so the zod contracts in `@devdigest/shared` never run on the client.

---

## Plan

Waves are ordered by value per unit of risk. A wave can merge on its own. Inside a wave, items are independent PRs unless marked →.

### Wave 0: user-visible bugs and safety nets (≈1–1.5 days)

| # | Item | Findings | Fix | Effort |
|---|---|---|---|---|
| 0.1 | Every mutation error toasts twice | ARCH-11 | `lib/providers.tsx:41-43` toasts every mutation error, and `DiffTab.tsx:36-37`, `AddRepoView.tsx:36-37` and `SettingsApiKeys.tsx:47-48` toast again locally. Needs decision **D1** first. | S |
| 0.2 | One verdict or severity, two colours | ARCH-9, ARCH-10 | Single source: `VerdictBanner/constants.ts` for verdicts and `SEV` in `vendor/ui/primitives/tokens.ts` for severity. Delete the local `VERDICT_COLOR` (`ReviewRunAccordion.tsx:15-19`) and the `FindingsSection.tsx:12-16` table. | S |
| 0.3 | Blocker count computed two ways | ARCH-8 | Use server `r.blockers` everywhere, or one helper `countBlockers(findings)` in `lib/`. Pick the one that matches server semantics (verify against `server/`). | S |
| 0.4 | ConfigTab resets 9 fields in an effect | REACT-1 | `<ConfigTab key={agent.id} agent={agent} />` in `AgentEditor.tsx:23`. Delete the effect at `ConfigTab.tsx:29-39` and its `eslint-disable`. | S |
| 0.5 | Error / not-found boundaries | NEXT-1, NEXT-2, NEXT-3 | Add `app/error.tsx`, `app/global-error.tsx` and `app/not-found.tsx`, plus a segment `error.tsx` under `repos/[repoId]/pulls/[number]/` so one broken PR doesn't blank the shell. Reuse `RepoNotFound`. Copy goes through next-intl (the `common` namespace). | S |
| 0.6 | Keyboard path for primary navigation | REACT-2…6 | `PRRow` and `AgentCard` become `next/link` (keyboard, middle-click, prefetch). The `SettingsApiKeys.tsx:63` reveal becomes a `<button aria-label aria-pressed>`. `PromptBlock.tsx:35` copies the existing `ToolCallRow` pattern. The `SearchableSelect` trigger becomes a `<button>`. | M |

**Exit criteria:** new RTL tests for 0.4 (switching agents shows the new values) and 0.6 (`getByRole('link', {name})`). For 0.1, one test asserts a single toast per failed mutation. Manually check in the browser: a thrown render error shows `error.tsx` and Tab reaches a PR row.

### Wave 1: thin routes and server-state hygiene (≈2–3 days)

| # | Item | Findings | Fix | Effort |
|---|---|---|---|---|
| 1.1 | PR detail page → `_components/PrDetailView/` | ARCH-1, ARCH-2, ARCH-12 | The page only resolves params. Invalidation of `["pr-active-runs"]` and `["pr-runs"]` moves into `useRunReview().onSuccess` in `lib/hooks/reviews.ts`. `FindingsTab` calls `useCancelRun()` itself instead of taking `UseMutationResult<any…>` as a prop. | M |
| 1.2 | PR list page → `PullsListView` + `helpers.ts` | ARCH-3, ARCH-36 | The filter/search/sort chain becomes a pure `filterAndSortPulls()` with tests. `OPEN_STATUSES` and `countNeedsReview` move to `src/lib/pr-status.ts` (the second consumer is `useShellContext.ts:75`). | M |
| 1.3 | Agent page → `AgentEditorView` | ARCH-4, ARCH-5, ARCH-32 | Resolve `AgentCard` crossing into a sibling route (promote it to `src/components/agent-card/`, or document the parent-route rule, see **D5**). Move `PROVIDER_OPTIONS` to `app/agents/constants.ts`. | M |
| 1.4 | Root page → `HomeRedirect` | ARCH-13 | Mechanical. | S |
| 1.5 | Deduplicate domain helpers | ARCH-33, 34, 35, 37 | One `lineLabel` (the exported one from `findings-popover`), one severity rank derived from `SEV`, and `formatWhen` moved to `src/lib/format-date.ts`. Type lookup tables as `Record<Severity, …>` instead of `Record<string, …>` so a misspelt key fails typecheck. | S |
| 1.6 | Imports: alias and barrels | ARCH-15, ARCH-39, ARCH-40 | Codemod the 61 `../../../` imports to `@/…`. Add `RunHistory/index.ts`. Consumers import `@/lib/hooks`, not `lib/hooks/reviews`. | S (codemod) |

**Exit criteria:** every `page.tsx` is ≤ ~30 lines with no `useState` or `useQueryClient`. `grep -rE 'from "(\.\./){3,}' client/src --exclude-dir=vendor` returns nothing. Typecheck, tests and e2e (`./scripts/e2e.sh`) are green, because these moves touch the paths the browser suite drives.

### Wave 2: i18n and styles in the "ported" files (≈2 days, parallelisable per screen)

| # | Item | Findings | Fix |
|---|---|---|---|
| 2.1 | Inlined copy → next-intl | ARCH-20…25 | New `addRepo.json`. Extend `prReview` (FindingsTab, ReviewRunAccordion, PrDetailHeader, DiffTab) and `agents`. Replace hand pluralisation (`finding{n===1?"":"s"}`) with ICU. `lib/toast.tsx` and `providers.tsx` use `common`. |
| 2.2 | Helpers return tokens, not copy | ARCH-26 | `relativeTime` returns `{unit, value}` and the view formats it. Same for `syncedLabel`. |
| 2.3 | Namespaces for shared leaves | ARCH-27, ARCH-28 | `diff-viewer` gets its own namespace instead of borrowing `shell` (same reasoning as `cost.json`). The nav labels in `vendor/ui/nav.ts` need **D6**. |
| 2.4 | Inline styles → `styles.ts` | ARCH-16…19, ARCH-29, ARCH-42 | AddRepoView, RunHistory, ReviewRunAccordion and the ARCH-19 list. Move `cs` out of `diff-viewer/comments.ts`. Magic sizes (`calc(100vh - 52px)`, `280`) become named constants. |

Do one screen per PR so each diff is reviewable, and apply the Wave 2 rules in any file Wave 1 already touches.

### Wave 3: design-system accessibility and missed promotions (≈2 days)

| # | Item | Findings | Fix |
|---|---|---|---|
| 3.1 | `Modal` / `Drawer` dialog semantics | REACT-7 | `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape closes, focus moves in on open and returns on close, Tab stays inside. `CommandPalette.tsx` already does this, so copy its approach. Evaluate the native `<dialog>` element (see **D4**). |
| 3.2 | `Dropdown` keyboard + ARIA | REACT-10 | `aria-haspopup`/`aria-expanded`, Escape, arrow-key roving. |
| 3.3 | `Chip` `aria-pressed` / `disabled` | REACT-9 | Once `Chip` supports both, `SeverityFilterBar` can drop its local copy (INSIGHTS notes it exists only because of this gap). |
| 3.4 | Promote `Disclosure` header | ARCH-30 | 4 hand-rolled `role="button"`+Enter/Space headers, 2 of them still unconverted. Build it in `@devdigest/ui` and render it in `Showcase.tsx`. |
| 3.5 | One trash action | ARCH-31 | Promote `RunHistory/_components/RowAction` and replace the 2 hand-rolled trash buttons (INSIGHTS: *not* `IconBtn`). |

### Wave 4: types, hydration, bundle (≈1–2 days)

| # | Item | Findings | Fix |
|---|---|---|---|
| 4.1 | Hydration-unsafe dates in render | NEXT-10 | `"use client"` pages are still SSR'd, so `toLocaleString()` in `ReviewRunAccordion.tsx:22-23` and `RunHistory.tsx:193,283` can differ between server and browser (timezone). Format with an explicit `timeZone` via next-intl `useFormatter`, or render after mount. Verify in the browser console first; the auditor only reasoned about the mechanism. |
| 4.2 | Casts and `!` | TS-4, TS-5, TS-7 | Remove the dead `as Verdict`. Replace `!` with a narrowed local. `FindingCard.tsx:75,80` casts because `@devdigest/ui` and `@devdigest/shared` each declare their own `Severity`/`Category` (see **D3**). |
| 4.3 | Route metadata | NEXT-6 | All 7 pages are `"use client"`, so none can export `metadata`. Once Wave 1 makes pages thin, each `page.tsx` can drop `"use client"` and export `metadata`. This comes almost free after Wave 1 and does not need the RSC data-fetching decision. |
| 4.4 | Suspense granularity | NEXT-5 | Replace the single root `fallback={null}` with per-route `loading.tsx` or local `<Suspense>` around the `useSearchParams` consumers. |
| 4.5 | Bundle check before optimising | REACT-8 | **Measure first** with `@next/bundle-analyzer`. `react-markdown` renders on the same route that needs it, so `next/dynamic` may buy little. Check whether `recharts` reaches pages through the `@devdigest/ui` barrel. |

### Wave 5: test debt (runs alongside Waves 1–4)

| # | Item | Findings |
|---|---|---|
| 5.1 | `src/test/render.tsx`: `renderWithProviders(ui, {namespaces, queryClient})` replaces the wrapper hand-rolled in 16 files | TEST (MEDIUM #1) |
| 5.2 | `apiFetch` unit tests: network failure, non-ok with JSON and non-JSON body, 204, content-type only when a body is present | untested #1 |
| 5.3 | `useRunEvents` (SSE): subscribe, parse, error count, cleanup on unmount | untested #2 |
| 5.4 | Pure diff logic: `parsePatch`, `buildThreads`/`partitionThreads` | untested #3 |
| 5.5 | Shortcut state machine (`useGlobalShortcuts`), formatters (`github-urls`, `model-label`, `sizeOf`, `relativeTime`), `ToolCallRow` | untested #4–5 |
| 5.6 | Query priority: `getByText("Accept")` → `getByRole("button", {name})` in `FindingCard` and `RunTraceDrawer` tests. Add the missing branches to `VerdictBanner`, `RunStatus` and `RunReviewDropdown` (one test each today). | TEST MEDIUM #2–3 |

Write the tests for 5.2 and 5.4 **before** the Wave 1 and Wave 4.2 refactors. They pin behaviour that those refactors move.

---

## Decisions needed

These change an established pattern, so per `frontend-architecture` they go through `docs/adr/` rather than a feature PR.

### D1: who reports a mutation error (blocks 0.1)

| Option | + | − |
|---|---|---|
| **A. Global only.** Delete the local `notify.error` calls. | One rule, no duplicates, least code | Loses the context-specific copy ("Couldn't post the comment to GitHub") |
| **B. Local wins.** The global handler skips a mutation if `meta.errorSurface === "local"`. | Keeps specific copy, explicit per mutation | Every such mutation must remember the flag. Needs a typed `Register` for `meta`. |
| C. Local only. Remove the `MutationCache` toast. | Full control | Easy to forget, and errors vanish silently |

**Recommendation: B.** Default to the global toast and opt out explicitly. It is one line per mutation, and a grep for `errorSurface` shows every exception.

### D2: validate API responses with zod? (TS-1)

| Option | + | − |
|---|---|---|
| A. Keep `as T` | Zero cost | Server/client contract drift (`vendor/shared` already differs in 5 files) surfaces as `undefined` deep in the UI |
| **B. `apiFetch(path, schema)` for the endpoints that feed critical flows, in dev/test only** | Catches drift in tests and e2e, no prod parse cost | Two behaviours per environment |
| C. Parse everywhere, always | Strongest guarantee | Runtime cost on large payloads (diffs, traces), and a strict parse breaks the UI on additive server changes unless schemas use `.passthrough()` |

**Recommendation: B**, starting with `reviews` and `pulls`. It turns the documented vendored-shared drift (ADR 0001) into a test failure instead of a runtime mystery.

### D3: one `Severity`/`Category` type (TS-5)

`@devdigest/ui` (editable) should import the types from `@devdigest/shared` instead of redeclaring them. That is a one-way dependency from the design system to the contracts, and ADR 0003 needs to say whether it is allowed. The alternative is a structural type test that fails when the two diverge.

### D4: native `<dialog>` vs hand-rolled focus management (3.1)

| Option | + | − |
|---|---|---|
| **Native `<dialog>` + `showModal()`** | Focus trap, Escape and the inert background come free | Animations and z-index work differently; jsdom support is partial (tests need a polyfill) |
| Hand-rolled (CommandPalette approach) | Already proven in the codebase and in its tests | More code to maintain, and edge cases (nested dialogs) stay on us |

**Recommendation:** native `<dialog>`, if the `Collapse`-style animation still works (check in Chrome). Otherwise extract CommandPalette's focus logic into `useDialogFocus`.

### D5: may a nested route use its parent route's `_components`? (ARCH-5)

The skill does not say. The low-cost choice is to allow parent → child and forbid sibling → sibling. Write that down; don't promote `AgentCard` just to satisfy an unwritten rule.

### D6: i18n for design-system data (`vendor/ui/nav.ts`)

Make the labels keys (`labelKey`) that the shell resolves through next-intl, as `useShellCommands.ts:24` already does for commands.

### Later, not blocking anything above

- **Query-key factory plus `queryOptions`.** Keys are already inconsistent (`["pull", id]` vs `["pulls", repoId]`). Worth an ADR after Wave 1, once invalidation lives only in `lib/hooks`.
- **Lint-enforced import boundaries.** Use `dependency-cruiser`, which the server already adopted (ADR 0005 / `arch:check`). Worth it once Wave 1 removes today's violations, so the gate starts green.
- **RSC data fetching.** Deliberately not proposed. The SPA-over-Fastify model is a course-level decision, and 4.3 already recovers metadata without it.

## Deliberately not in the plan

- **ARCH-6** (`diff-viewer` promoted with one consumer): the premature promotion is real, but moving 13 files back buys nothing today, and later lessons may add consumers. Revisit if nothing else imports it by L08.
- `mermaid-diagram` and `FeaturePlaceholder` have zero consumers. They are treated as lesson scaffolding, like the unused `messages/*.json`.
- **SEC-1** (`CommentCard.tsx:25` has no protocol allowlist on a GitHub-generated `html_url`): LOW and theoretical. Fold it into 2.4 if that file is touched.
- Any Tailwind or styled-lib migration suggested by the `vercel:react-best-practices` plugin contradicts ADR 0003.

## Coverage gaps

- Nobody read these line by line; they were checked only by grep sweeps: `vendor/ui/charts/*`, `vendor/ui/shell/*`, most small `vendor/ui` primitives, diff-viewer's `CommentThreadView`/`FileCard`/`OutdatedComments`, `lib/theme.tsx`, `useGlobalShortcuts.ts`, and several leaves (OverviewTab, VerdictBanner, SettingsModels). "No finding" there has lower confidence than elsewhere.
- `messages/*.json` content was not reviewed.
- Nothing was run in a browser. The a11y findings are static-analysis results, and 4.1 (hydration) is reasoned from the mechanism only.
- The `vendor/shared` drift (5 files differ from `server/`) was detected but the contents were not compared.
