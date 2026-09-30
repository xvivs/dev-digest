# Spec: Mobile navigation drawer and responsive Topbar

**Status:** APPROVED (human, 2026-09-30) · **Branch:** work directly on `feat/pr-overview` (HEAD `fe581cb`). It ships as one PR together with PR Overview; there is no separate branch. Do **not** use `main`: the `<main> position: relative` fix in `AppFrame.tsx:29-33`, which AC-11 depends on, exists only on `feat/pr-overview`. Line refs are to `fe581cb` (no change-site file differs from `38bab95`) · **Approach:** below 768px hide the sidebar with CSS and open the same content in a left `Drawer` from a Topbar burger. Below 1024px the Topbar search becomes an icon button. Crumbs truncate at every width. Chosen by the human after brainstorm (in the delegation prompt, not a file).

## Problem & Motivation

The app frame has no responsive behaviour. `Sidebar` is a fixed `width: 264, flexShrink: 0` aside (`client/src/vendor/ui/shell/Sidebar.tsx:14-15`) that `AppFrame` always renders (`client/src/vendor/ui/shell/AppFrame.tsx:26`). At a 500px window the content column was 152px wide and `document.documentElement.scrollWidth` was 609 (orchestrator's browser evidence), so the whole page scrolls sideways.

The Topbar also misbehaves above the breakpoint, with the sidebar present. A static replica of `Topbar.tsx` (same inline styles, crumbs `acme/payments-api › Pull requests › #42` as on PR detail, `PrDetailView.tsx:26-30`), measured with `agent-browser` in this session:

| Viewport | Header width | Crumbs box / content | Search width / height | Crumb text overlaps search? |
|---|---|---|---|---|
| 768 | 504 | 165 / 308 | 154 / **48** (label wraps to 2 lines) | yes, by ~127px |
| 900 | 636 | 237 / 308 | 207 / 33 | yes, by ~55px |
| 1023 | 759 | 304 / 308 | 257 / 33 | touching (~4px into the gap) |
| 1100 | 836 | 308 / 308 | 260 / 33 | no |

Document scroll stays at the viewport width there (the header is `minWidth: 0`), but crumb text paints over the search button and the search label wraps. The cause: crumb spans are `whiteSpace: nowrap` with no `overflow`/`textOverflow` (`Topbar.tsx:35`), and the search button has `width: 260` (`Topbar.tsx:59`) with a wrapping label (`Topbar.tsx:69`). So the 768–1023 range is in scope.

## Goals / Non-goals

### Goals
- G1. Below 768px, no sidebar in the layout; a burger in the Topbar opens the full sidebar content in a left drawer.
- G2. No horizontal document scroll at 390 / 500 / 768 / 1024 / 1440px caused by the frame (sidebar + Topbar).
- G3. The Topbar never paints crumbs over its controls at any width. Crumbs truncate with an ellipsis, and the current-page crumb truncates last. Below 1024px the search is an icon button, so its label cannot wrap.
- G4. The drawer is keyboard-accessible: focus in, Tab trap, Escape, focus back to the burger (ADR 0009, via the existing `useDialogFocus`).
- G5. Server HTML already has the right layout: show/hide is CSS only, so there is no flash and no hydration mismatch.

### Non-goals
- Making page bodies (tables, diff viewer, PR detail panes) responsive. `<main>` stays the scroll container (`AppFrame.tsx:33`), so wide page content scrolls inside `<main>`, not the document.
- An icon rail or collapsed sidebar at 768–1023. No new dependencies.
- Translating the existing hard-coded Topbar strings ("Search or jump to…", "Toggle theme", "Notifications").
- Tests. The human deferred them for this iteration: see Test plan (DEFERRED).
- Closing the drawer when the window is widened past 767px (see Decisions D8).

### Decisions
- **D1. Two breakpoints** (human decisions): **md = `max-width: 767px`** for sidebar ↔ burger, and **lg = `max-width: 1023px`** for full search ↔ search icon. Each inverse rule is written `@media not all and (max-width: …)`, not `(min-width: 768px)` / `(min-width: 1024px)`. That makes it an exact complement: at fractional CSS widths (zoom, e.g. 767.5px) `min-width: 768px` and `max-width: 767px` both miss, and the page would show neither the sidebar nor the burger.
- **D2. Visibility utilities use `!important` in `styles.css`.** Four global classes: `.dd-hide-below-md` / `.dd-show-below-md` (display none at ≤767 / ≥768) and `.dd-hide-below-lg` / `.dd-show-below-lg` (display none at ≤1023 / ≥1024). An author `!important` declaration beats a normal inline style, so the element keeps its inline `display` (`flex`, `inline-grid`) wherever it is visible, and no inline `width`/`display` has to move into a class. This is the same approach as Bootstrap's `d-none`. The alternative, moving `width`/`display` out of inline styles into per-element classes, touches more code and splits one element's styling across two places. **New pattern:** first responsive rules in `@devdigest/ui`; until now the only media query is `prefers-reduced-motion` (`styles.css:312`). It amends ADR 0003's "inline CSSProperties" rule, so **ADR 0024 is written in this change** (change site 15; AR-1, PC-6).
- **D3. The Topbar's per-breakpoint `padding`/`gap` stay inline but read CSS variables** (AR-2): `gap: "var(--dd-topbar-gap)"`, `padding: "0 var(--dd-topbar-pad-x)"`. They are defined in the existing unthemed `:root` block (`styles.css:167`, next to `--card-pad`) (`--dd-topbar-gap: 16px; --dd-topbar-pad-x: 24px`) and overridden to `8px`/`12px` under `@media (max-width: 767px)`. No component class, no `!important`, and it follows "themed entirely through CSS variables" (`vendor/ui/README.md:3`). Budget at 390px after the override: 12+12 padding, burger 30, search icon 30, theme 30, bell 30, avatar 26, 5 gaps × 8 = 210px fixed, which leaves 180px for crumbs.
- **D4. 768–1023 fix (human decision, OQ-3): search becomes an icon below 1024; crumbs truncate.** Crumbs container becomes `flex: 1 1 auto; minWidth: 0; overflow: hidden` (overflow is the AC-9 backstop). Each crumb flex item (the `Link` for a linked crumb, otherwise the `<span>`) gets `minWidth: 0; overflow: hidden; textOverflow: ellipsis; whiteSpace: nowrap`. Non-last items get `flex: "0 1 auto"`. The **last** item (the current page, e.g. `#42`, `PrDetailView.tsx:29`) gets `flex: "0 0 auto"; maxWidth: "75%"` (percent of the crumbs container). Ancestors therefore truncate first, and the current-page crumb stays whole unless it alone is wider than 75% of the container. At 768 the container is ≈146px, so the cap is ≈109px, which fits "Pull requests" (≈95px, `PullsListView.tsx:53`) and `#<n>` (PC-7, PC-11). `title={label}` always goes on the inner text `<span>`, because `LinkLike` has no `title` prop (`types.ts:4-10`; PC-4). The full 260px search button keeps its inline styles as today (`width: 260`, `Topbar.tsx:59`) and gets `className="dd-hide-below-lg"`. A new search `IconBtn` gets `className="dd-show-below-lg"`, so it shows at every width ≤1023, including ≤767. Measured on the static replica with the icon search (`agent-browser`, this session):

  | Viewport | Crumbs box / content | Crumbs right edge vs search-icon left | Items (visible / full width) |
  |---|---|---|---|
  | 768 | 276 / 276 | 564 < 580, no overlap | repo 118/143 "acme/payments-a…", "Pull req…" 67/81, `#482` 34/34 whole |
  | 900 | 408 / 408 | 696 < 712 | everything whole |
  | 1023 | 531 / 531 | 819 < 835 | everything whole |

  So 768 fits: the ≈127px overlap is gone, only the ancestors are shortened a little, and the last crumb stays whole. At 768 the 75% cap is ≈207px, so "Pull requests" as the last crumb on the list page (`PullsListView.tsx:53`) fits easily. Cost: below 1024 the visible "Search or jump to… ⌘K" hint is gone. The icon has an accessible name and a `title` via `IconBtn` (`IconBtn.tsx:24-25`), and ⌘K itself still works. The ellipsis/nowrap rules apply at all widths but only take effect on overflow, so ≥1024 looks the same as today.
- **D5. Drawer state lives in `AppShell`** (`client/src/components/app-shell/AppShell.tsx`), next to `paletteOpen`/`helpOpen` (`AppShell.tsx:11-12`). `AppShell` renders `<Drawer side="left">` after `AppFrame`, the same way it renders `CommandPalette` (`AppShell.tsx:27`). `AppFrame` stays stateless. Reason: only `AppShell` knows the route (`usePathname`), and `@devdigest/ui` has no router.
- **D6. Close on navigation, two mechanisms, no effect:**
  (a) `SidebarContent` takes `onNavigate?: () => void`, forwarded to every `Link` `onClick` (logo + each `NavItem`). This covers a click on the already-active item, where the pathname does not change.
  (b) `AppShell` keeps `prevPathname` in state and, during render, when `pathname !== prevPathname`, sets both `prevPathname` and `navOpen=false`. This is React's "adjusting state when a prop changes" pattern (react-best-practices: no `useEffect` for derived state). It covers `router.push` from `RepoSwitcher` (`useShellContext.ts:35,40`), `g`-chords and browser Back.
  Why not derive `open = openedAt === pathname`: after A → B → Back to A, the drawer would reopen.
- **D7. Mounted only while open.** `{navOpen && <Drawer …/>}`. The e2e flows count `[role='dialog']` (`e2e/specs/11-skills.flow.json:52,72,88`), and `useDialogFocus` defaults to `open = true` for mount-while-open dialogs (`useDialogFocus.ts:57`).
- **D8. The drawer is not CSS-hidden at ≥768.** If the user widens the window while it is open, it stays visible and usable (Escape, backdrop, links) until closed. A CSS-hidden but mounted dialog would keep the Tab trap on an invisible node, which is worse. No `matchMedia` listener.
- **D9. Labels via `ShellContext`, not i18n inside `@devdigest/ui`.** New optional `ShellContext.onOpenNav?: () => void` and `ShellContext.labels?: { openNav?: string; search?: string }`, with English fallbacks in `Topbar` ("Open navigation", "Search"). Same injection route as `translateNav` (`types.ts:37-42`), but a record of strings rather than a resolver, matching how kit components take labels (`Drawer closeLabel`, `Drawer.tsx:13`). `AppShell` passes `title`/`closeLabel` to `Drawer` itself from `shell.json`. The burger renders only when `ctx.onOpenNav` is set, following the `onToggleTheme` precedent (`Topbar.tsx:72`).
- **D10. `IconBtn` gains two optional props:** `className?: string` (needed for the visibility utilities) and `hasPopup?: "dialog"` (renders `aria-haspopup`). No `aria-expanded`: the trigger sits behind an `aria-modal` dialog while it is open, so the state is never announced, and `aria-controls` would point at a node that does not exist while closed. With neither prop set, the rendered `<button>` is unchanged.
- **D11. `SidebarContent` owns its layout** (AR-4, supersedes the round-1 consumer-side wrapper). Its root is a `<div>` with `display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0`. The aside keeps its own style (`Sidebar.tsx:12-24`) and gains one wrapper `div`. No test, flow or selector depends on the aside's direct children (verified by the architecture-reviewer's finding-verifier). `flex: 1; minHeight: 0` keeps the nav's `overflowY: auto` scrolling inside the aside. Without a flex column (PC-2), the `Dropdown` root, which is `display: inline-block` (`Dropdown.tsx:220`), shrinks to its content, so the `RepoSwitcher` trigger's `width: 100%` (`RepoSwitcher.tsx:32`) collapses, and a long `nowrap` name (`RepoSwitcher.tsx:65`) scrolls the drawer sideways. In the block Drawer body, the root's `flex: 1` and the nav's `flex: 1; overflowY: auto` (`Sidebar.tsx:44`) are inert, so the Drawer body (`Drawer.tsx:78`) scrolls instead. Every consumer (aside, AppShell drawer, Showcase) gets the same layout with no wrapper.
- **D14. The left drawer's shadow points right.** `--shadow-drawer` is `-8px 0 32px …` in both themes (`styles.css:42,82`). Add `--shadow-drawer-left: 8px 0 32px <same rgba>` next to each of them. `Drawer side="left"` uses it (PC-3).
- **D15. Focus-return scope.** Safari/iOS does not focus a `<button>` on tap, so `useDialogFocus` falls back to `lastOutsideFocus` (`useDialogFocus.ts:109`) and focus may not land on the burger. AC-5's focus clause is verified in Chromium, and the Safari case is a known limitation. The same applies after D8: once the window is widened, the burger is `display: none` and `opener.focus()` is a no-op, so focus goes to `<body>` (PC-5, AR open question).
- **D12. Drawer width 304px**, exported as `NAV_DRAWER_WIDTH` from `shell/SidebarContent.tsx` (like `TOPBAR_HEIGHT`, `Topbar.tsx:8`) so `AppShell` and the Showcase share one value. Budget: 304 − 1 border (`box-sizing: border-box`, preflight) − 2×24 body padding (`Drawer.tsx:78`) = 255px content, which leaves 240px even when a classic ~15px scrollbar appears. That fits the 240px `RepoSwitcher` menu (`RepoSwitcher.tsx:23`) without horizontal scroll (PC-8). `maxWidth: 94%` (`Drawer.tsx:47`) keeps it inside 320px screens.
- **D13. Drawer title "Navigation" is visible.** `Drawer` always renders its `<h2>` (`Drawer.tsx:67`), so `ariaLabel` alone would leave an empty heading.
- Assumed: `agent-browser`'s default viewport used by `./scripts/e2e.sh` is ≥768px wide, so the e2e suite keeps seeing the desktop sidebar (`02-repo-pulls-detail.flow.json:24` waits for `acme/payments-api`). `e2e/agent-browser.json` sets no viewport. Verified by step 9's `./scripts/e2e.sh` run.

## Acceptance criteria (EARS)

- **AC-1.** While the viewport is ≤767px wide, the app frame shall not display the sidebar `<aside>`, and shall display a burger button named "Open navigation" (with `aria-haspopup="dialog"`) as the first control in the Topbar.
- **AC-2.** While the viewport is ≥768px wide, the app frame shall display the 264px sidebar as today and shall not display the burger (`display: none`, out of the accessibility tree). While it is ≥1024px wide, it shall also not display the search icon button, and shall display the 260px search button as today.
- **AC-3.** When the user activates the burger, the shell shall mount exactly one `role="dialog"` named "Navigation" that slides in from the left. It contains the DevDigest logo link, the `RepoSwitcher`, every `NAV` item and Settings, and focus moves inside it.
- **AC-4.** While the drawer is closed, the shell shall render no drawer node (`[role='dialog']` count is 0 on a page with no other open dialog).
- **AC-5.** When the user presses Escape, clicks the backdrop or activates the close button, the drawer shall unmount, and in Chromium focus shall return to the burger (Safari: D15).
- **AC-6.** When the user activates any link inside the drawer, or the pathname changes for any reason (repo switch, `g`-chord, Back), the drawer shall close.
- **AC-7.** While the drawer is open, Tab / Shift+Tab shall cycle only within the drawer.
- **AC-8.** While the viewport is ≤1023px wide, the Topbar shall replace the 260px search button with an icon button named "Search" that opens the command palette.
- **AC-9.** When crumbs do not fit, the Topbar shall truncate them with an ellipsis, keep the full label in `title`, and not paint crumb text over any Topbar control, at every viewport width.
- **AC-10.** While the viewport is 768–1023px wide, the Topbar shall stay 52px tall, and the last crumb shall be fully visible (`scrollWidth <= clientWidth`) unless its label alone is wider than 75% of the crumbs container. Only earlier crumbs end in "…", and no crumb text overlaps the search icon.
- **AC-11.** At 390, 500, 768, 1024 and 1440px on `/repos/:id/pulls` and a PR detail page, `document.documentElement.scrollWidth` shall equal `window.innerWidth`.
- **AC-12.** When `Drawer` is rendered without `side`, it shall behave and render exactly as today (right side). `client/src/vendor/ui/kit/Drawer.test.tsx` passes unedited.
- **AC-13.** The Showcase gallery shall offer a button that opens a left `Drawer` holding `SidebarContent`, and `client/src/test/smoke.test.tsx` shall still pass. The smoke test renders the gallery closed, so it proves the imports and the render, not the open drawer. The Showcase has no route (`client/AGENTS.md:36-37`), so the open left drawer is verified through the AppShell drawer, which uses the same `SidebarContent` + `Drawer side="left"` (PC-9).
- **AC-14.** The shell shall take the burger label, the search-icon label and the drawer title from `messages/en/shell.json` (the close label reuses `shell.ui.close`). Without `ctx.labels`, `Topbar` shall fall back to English.
- **AC-15.** The sidebar/burger/search visibility shall be decided by CSS only: `grep -rn matchMedia client/src/vendor/ui/shell client/src/components/app-shell` returns nothing.

## Change sites

| # | File | Change | Layer | AC | Risk |
|---|---|---|---|---|---|
| 1 | `client/src/vendor/ui/styles.css` | Add `.dd-hide-below-md` / `.dd-show-below-md` and `.dd-hide-below-lg` / `.dd-show-below-lg` (D1, D2); `--dd-topbar-gap: 16px; --dd-topbar-pad-x: 24px` in the existing unthemed `:root` (`:167`) with a ≤767 override to 8px/12px (D3); `--shadow-drawer-left` beside `--shadow-drawer` in both theme blocks (`:42`, `:82`; D14); `@keyframes ddslideinleft` (`translateX(-100%)` → `0`) next to `ddslidein` (`:241-247`). Rules are unlayered, placed before the `prefers-reduced-motion` block (`:312`) | design system | 1, 2, 8, 10, 15 | L: plan-critic verified that `@tailwindcss/postcss` keeps `not all and` verbatim; step 1 re-checks it |
| 2 | `client/src/vendor/ui/kit/Drawer.tsx` | `side?: "left" \| "right"` (default `"right"`). Left: root `justifyContent: "flex-start"`, panel `borderRight` instead of `borderLeft`, `boxShadow: "var(--shadow-drawer-left)"`, animation `ddslideinleft`. Right branch unchanged | design system | 3, 12 | L |
| 3 | `client/src/vendor/ui/primitives/IconBtn.tsx` | Optional `className`, `hasPopup?: "dialog"` → `aria-haspopup` (D10) | design system | 1, 8 | L |
| 4 | `client/src/vendor/ui/shell/NavItem.tsx` | Optional `onNavigate?: () => void` → `Link onClick` | design system | 6 | L |
| 5 | `client/src/vendor/ui/shell/SidebarContent.tsx` (new) | Body of today's aside (`Sidebar.tsx:25-80`: logo link, `RepoSwitcher`, NAV groups, Settings) inside the flex-column root `div` (D11). Props `{ ctx: ShellContext; onNavigate?: () => void }`; `onNavigate` goes to the logo `Link` and every `NavItem`. Also `export const NAV_DRAWER_WIDTH = 304` (D12) | design system | 3, 6 | L |
| 6 | `client/src/vendor/ui/shell/Sidebar.tsx` | `<aside className="dd-hide-below-md" style={…unchanged}>` wrapping `<SidebarContent ctx={ctx} />` | design system | 1, 2 | L |
| 7 | `client/src/vendor/ui/shell/types.ts` | `ShellContext.onOpenNav?`, `ShellContext.labels?: { openNav?: string; search?: string }` with doc comments (D9) | design system | 1, 14 | L |
| 8 | `client/src/vendor/ui/shell/Topbar.tsx` | Inline `gap: "var(--dd-topbar-gap)"`, `padding: "0 var(--dd-topbar-pad-x)"` (D3). Burger `IconBtn icon="Menu"` (exists, `icons.tsx:70`) with `className="dd-show-below-md"`, `hasPopup="dialog"`, first child, only if `ctx.onOpenNav`. Crumbs container `flex: 1 1 auto`; crumb item ellipsis, `title` on the inner span (D4); the linked crumb passes the ellipsis style to `Link` (`LinkLike` accepts `style`, `types.ts:7`). Crumbs container gets `overflow: hidden`; last crumb `flex: 0 0 auto; maxWidth: 75%`, others `flex: 0 1 auto` (D4). Full search button: inline styles unchanged, plus `className="dd-hide-below-lg"`. New search `IconBtn icon="Search"` with `className="dd-show-below-lg"` and `onClick={ctx.onOpenCommandPalette}` | design system | 1, 2, 8, 9, 10, 14 | M: the visual regression is only visible in a browser |
| 9 | `client/src/vendor/ui/shell/index.ts` | `export { SidebarContent, NAV_DRAWER_WIDTH } from "./SidebarContent";` (root barrel already re-exports `./shell`, `vendor/ui/index.ts:10`) | design system | 3, 13 | L |
| 10 | `client/src/components/app-shell/hooks/useShellContext.ts` | Option `onOpenNav: () => void`, put into ctx. `labels: { openNav: t("topbar.openNav"), search: t("topbar.search") }`. Add to the `useMemo` deps | client (chrome) | 1, 8, 14 | L |
| 11 | `client/src/components/app-shell/AppShell.tsx` | `navOpen` state + `prevPathname` render-time reset (D6b). `openNav`/`closeNav` via `useCallback` (they feed `useShellContext`'s memo). `usePathname`, `useTranslations("shell")`. Render `{navOpen && <Drawer side="left" width={NAV_DRAWER_WIDTH} title={t("navDrawer.title")} closeLabel={t("ui.close")} onClose={closeNav}><SidebarContent ctx={ctx} onNavigate={closeNav} /></Drawer>}` (`NAV_DRAWER_WIDTH` from `@devdigest/ui`) after `AppFrame`. Update the header comment to say that resetting overlay state on a route change stays local to `AppShell` (AR-3 nit) | client (chrome) | 3-7 | M: see Risks R2 |
| 12 | `client/messages/en/shell.json` | Add `topbar.openNav` "Open navigation", `topbar.search` "Search", `navDrawer.title` "Navigation" | client (i18n) | 14 | L |
| 13 | `client/src/components/showcase/Showcase.tsx` | Add a "Open left Drawer" `Button` to the "Tabs / Dropdown / Overlays" group (`:266`), a `leftDrawer` state, and `{leftDrawer && <Drawer side="left" width={NAV_DRAWER_WIDTH} title="Navigation" onClose={…}><SidebarContent ctx={{}} /></Drawer>}` beside the existing Drawer (`:342-345`) | dev gallery | 13 | L |
| 14 | `client/src/vendor/ui/README.md` | Conventions: one bullet on the responsive utilities (`dd-{hide,show}-below-{md,lg}`, breakpoints 767px / 1023px, why `!important`) and on per-breakpoint values as CSS variables (`--dd-topbar-*`). Shell row: add `SidebarContent` | docs | — | L |
| 15 | `docs/adr/0024-responsive-utilities-in-vendored-ui.md` (new; the last ADR is 0023) | Context / Decision / Consequences / Alternatives. The two breakpoints, md 767px (sidebar ↔ burger) and lg 1023px (full search ↔ icon), what each one governs and why they differ, and the `not all and` complement (D1); `!important` visibility utilities (D2); per-breakpoint values as CSS variables rather than classes (D3); CSS-only show/hide for SSR. Explicitly amends ADR 0003's inline-styles rule, with a `**Amends:** ADR 0003, Decision (inline CSSProperties)` header line (convention: `0013:5`, `0014:5`). Naming rule: new layout vars and utility classes take a `dd-` prefix to avoid clashing with Tailwind 4 utilities (existing `--gap`, `.mono`, `.skeleton` predate it) | docs (ADR) | — | L |
| 16 | `docs/adr/0003-collapse-in-vendored-ui.md` | Status line (`:3`) becomes `accepted · inline-styles rule amended by [ADR 0024](0024-responsive-utilities-in-vendored-ui.md)` (convention: `0012:3`, `0006:3`; AR-5) | docs (ADR) | — | L |

Not touched: `AppFrame.tsx` (the aside hides itself; its `<main> position: relative` must already be there, step 0), `Sidebar`'s inline width, `useDialogFocus.ts`, `specs/04-pr-overview.md` and the PR Overview files (no overlap with the paths above; `primitives/SectionLabel.tsx` is not a change site).

## Steps

Every step's verify also includes `cd client && pnpm typecheck && pnpm test` → exit 0, with `Drawer.test.tsx`, `smoke.test.tsx`, `PullsListView.test.tsx` and `SkillEditorView.test.tsx` green (the last two render the real `AppShell`). Grep the output for `MISSING_MESSAGE` → none (INSIGHTS 2026-09-28).

0. **Base check.** Verify: `git rev-parse --abbrev-ref HEAD` → `feat/pr-overview`; `git merge-base --is-ancestor fe581cb HEAD && grep -c 'position: "relative"' client/src/vendor/ui/shell/AppFrame.tsx` → exit 0 and `1`. Otherwise stop: wrong base (PC-1).
1. **CSS utilities, topbar variables, left shadow token, keyframe** (site 1). Verify: `cd client && pnpm typecheck && pnpm test`. Then (with no `next dev` running from this `client/`, since the build overwrites `.next`) `cd client && pnpm exec next build` → succeeds, and `grep -Eo "[^{}]*767(\.[0-9]+)?px[^{]*" .next/static/css/*.css` → at least 2 matches (the md hide and show rules, plus the topbar-variable override), and `grep -Eo "[^{}]*1023(\.[0-9]+)?px[^{]*" .next/static/css/*.css` → at least 2 matches (the lg hide and show rules). Inspect them by eye: any equivalent form (`not all and (max-width:767px)`, range syntax) is fine, a missing rule is not (PC-10).
2. **`Drawer side`** (site 2). Verify: `cd client && pnpm exec vitest run src/vendor/ui/kit/Drawer.test.tsx` → 6 passed, file unedited (`git diff --stat client/src/vendor/ui/kit/Drawer.test.tsx` empty).
3. **`IconBtn` props, `NavItem.onNavigate`** (sites 3, 4). Verify: `cd client && pnpm typecheck && pnpm test` → green.
4. **Extract `SidebarContent` (+ `NAV_DRAWER_WIDTH`); `Sidebar` uses it with the class; export both** (sites 5, 6, 9). Verify: `cd client && pnpm typecheck && pnpm test` → green. Plus `git diff client/src/vendor/ui/shell/Sidebar.tsx` shows the aside's `style` object unchanged; its only child is now `<SidebarContent ctx={ctx} />`.
5. **`ShellContext` fields + Topbar rework** (sites 7, 8). Verify: `cd client && pnpm typecheck && pnpm test` → green. With `onOpenNav` not wired yet, no burger renders, so existing tests stay put.
6. **Messages + `useShellContext` + `AppShell` drawer** (sites 10-12). Verify: `cd client && pnpm typecheck && pnpm test` → green, and `grep -rn matchMedia client/src/vendor/ui/shell client/src/components/app-shell` → empty (AC-15).
7. **Showcase** (site 13). Verify: `cd client && pnpm exec vitest run src/test/smoke.test.tsx` → passed (AC-13).
8. **README + ADR 0024 + ADR 0003 back-link** (sites 14-16). Verify: `grep -n "dd-hide-below-md" client/src/vendor/ui/README.md docs/adr/0024-responsive-utilities-in-vendored-ui.md` → 1+ line in each; `grep -n "Amends:.*0003" docs/adr/0024-responsive-utilities-in-vendored-ui.md` → 1 line; `grep -n "0024" docs/adr/0003-collapse-in-vendored-ui.md` → 1+ line.
9. **Manual browser check + e2e.** `./scripts/dev.sh` (seeded DB), then in a browser at 390 / 500 / 768 / 900 / 1023 / 1024 / 1440px, on `/repos/<id>/pulls` and `/repos/<id>/pulls/<n>`:
   - `document.documentElement.scrollWidth === innerWidth` (AC-11);
   - ≤767: no aside, burger + search icon visible (AC-1, AC-8); 768–1023: aside + search icon, no burger; ≥1024: aside + full 260px search, no burger or icon (AC-2, AC-8). Check 767↔768 and 1023↔1024 explicitly;
   - burger opens the left drawer; `document.querySelectorAll("[role='dialog']").length === 1` (AC-3); closed → 0 (AC-4);
   - (Chromium) Escape, backdrop, close button each close it and `document.activeElement` is the burger (AC-5);
   - in the drawer, the `RepoSwitcher` trigger fills the content box (≥238px), and with a long repo name and with its menu open the drawer body has `scrollWidth === clientWidth` (D11, D12);
   - **PC-11, checked here instead of a re-review (human decision):** at 390, 768, 900, 1023 and 1024 on PR detail (`#<n>`) and the list ("Pull requests"), the last crumb is readable (`el.scrollWidth <= el.clientWidth`), earlier crumbs end in "…" where they don't fit, and no crumb text overlaps a Topbar control (compare the crumbs container's `getBoundingClientRect().right` with the next control's `left`). Exception: a label alone wider than 75% of the crumbs container, such as a long agent or skill name in editor crumbs, may truncate (D4, AC-9, AC-10). At 1024 the full search is back and the crumb budget drops by ~230px: record whether ancestors truncate there;
   - the left drawer's shadow falls to its right (D14);
   - a nav link, the active nav item, and a repo switch via `RepoSwitcher` each close it (AC-6);
   - Tab from the last item wraps to the close button (AC-7);
   - with the OS "reduce motion" setting on, the drawer appears without sliding.
   Then `./scripts/e2e.sh` → all flows pass (desktop viewport; guards the Assumed in Decisions).

## Test plan

**DEFERRED** by human decision: none of these files are created in this iteration. The steps create no tests. When un-deferred: colocated RTL with `client/src/test/render.tsx`, and `fireEvent` rather than `userEvent` (`@testing-library/user-event` is not a dependency, INSIGHTS Tool & Library Notes).

| AC | Test file (exact path) | Kind | Case |
|---|---|---|---|
| 3, 4, 5, 7 | `client/src/components/app-shell/AppShell.test.tsx` | RTL | Burger opens one dialog "Navigation" with nav links; Escape closes it; focus is back on the burger; no dialog while closed |
| 6 | `client/src/components/app-shell/AppShell.test.tsx` | RTL | Clicking a nav link closes; re-rendering with a changed mocked `usePathname` closes; Back to the original path does not reopen |
| 12 | `client/src/vendor/ui/kit/Drawer.test.tsx` (new case appended, existing cases untouched) | RTL | `side="left"` still traps focus and names the dialog |
| 1, 8, 14 | `client/src/vendor/ui/shell/Topbar.test.tsx` | RTL | Burger only when `onOpenNav` is set; search icon calls `onOpenCommandPalette`; labels from `ctx.labels`, English fallback |
| 9 | `client/src/vendor/ui/shell/Topbar.test.tsx` | RTL | Each crumb has `title` = label |
| 1, 2, 11 | `e2e/specs/12-mobile-nav.flow.json` | e2e flow | `set viewport 390 800`: aside hidden, burger opens drawer, dialog count 1, Escape → 0; `scrollWidth` check |

jsdom does not apply `styles.css`, so AC-1/2/10/11 (media queries, layout) can only be verified in a browser or e2e.

## Edge cases

- **Active nav item clicked in the drawer**: pathname unchanged, closed by `onNavigate` (D6a).
- **Browser Back to the page where the drawer was opened**: stays closed (D6b resets state; it is never derived from the path).
- **Pages remount `AppShell`** (every page renders its own, `layout.tsx:34-35`): navigating to another route drops the state anyway. The opener is then disconnected, so `useDialogFocus` skips the restore (`useDialogFocus.ts:150`) and Next's route focus applies.
- **⌘K while the drawer is open**: `CommandPalette` mounts outside the drawer node, so `pushDialog` stacks it on top (`useDialogFocus.ts:50-54`). Escape closes the palette first, then the drawer (INSIGHTS 2026-09-28 dialog stack).
- **RepoSwitcher menu inside the drawer**: `Dropdown` is `position: absolute` in its trigger (`Dropdown.tsx:220-239`), inside the dialog, so it is part of the Tab trap. Its Escape `preventDefault`s (`Dropdown.tsx:191-192`), so the drawer stays open. The 240px menu (`RepoSwitcher.tsx:23`) fits the 255px content box, and still fits with a classic scrollbar (D12). Check this in step 9.
- **"Remove repo" from the drawer**: `window.confirm` (`useShellContext.ts:45`). The drawer stays open unless the active repo was removed, in which case navigation closes it.
- **Window widened while open**: the drawer stays until closed (D8). On close, focus goes to `<body>` because the burger is now hidden (D15).
- **Safari tap**: focus return may miss the burger (D15).
- **Dynamic-segment remount**: Next usually remounts the page, and with it `AppShell`, when `[repoId]` changes. D6b then mostly guards same-page pathname changes. It is kept as a cheap guard.
- **320px screens**: drawer is `min(304, 94%)` ≈ 301. Crumbs get ~110px after D3.
- **1024–~1100px**: the full 260px search is back. The round-1 replica showed crumbs touching the search at 1023 with the old layout (Problem table). With the new ellipsis, ancestors truncate instead of overlapping. Step 9 checks 1024.
- **Reduced motion**: the global rule (`styles.css:312-319`) shortens `ddslideinleft` too.
- **Fractional widths (zoom)**: no dead zone between the two rules (D1).

## Risks & rollback

- **R0. Wrong base branch** (`main` lacks the `<main>` fix, so AC-11 fails for unrelated reasons). Step 0.
- **R1. Tailwind 4 / Lightning CSS rewrites or drops the `not all and` media query.** plan-critic ran `@tailwindcss/postcss` minify and it kept the query verbatim. Step 1 re-checks the built CSS. Fallback: `(width >= 768px)` range syntax, which gives the same exact complement.
- **R2. `AppShell`'s new callbacks break `useShellContext`'s memo** (a new `onOpenNav` identity every render re-renders the whole frame). Mitigation: `useCallback` with `[]` deps, like `openPalette` (`AppShell.tsx:13`).
- **R3. Existing RTL suites that render the real `AppShell`** (`PullsListView.test.tsx`, `SkillEditorView.test.tsx`) now also see a "Open navigation" and a "Search" button, because jsdom ignores media CSS. Checked: no suite queries a button name matching those, and `rowTitles` filters links by href (`PullsListView.test.tsx:94-97`). Steps 5-6 run both.
- **R4. Visual regression at ≥1024**: ellipsis/nowrap only act on overflow, and the search keeps its 260px inline width. Step 9 checks 1024 and 1440.
- **R6. Tablet/small-laptop discoverability (768–1023)**: the visible "Search or jump to… ⌘K" hint is replaced by an icon. The accepted cost of the human's OQ-3 choice. The icon's `title` shows "Search" on hover, and ⌘K is still listed in `ShortcutsHelp` (`?`).
- **R7. Replica fidelity**: the 768 measurements used fallback fonts (Inter was not installed) and a static copy of `Topbar.tsx`, and the ancestors come within ~16px of the icon. A wider real font could make ancestors truncate harder, but cannot cause overlap, because the container is `overflow: hidden`. Step 9 measures the real app.
- **R5. e2e runs at a narrow default viewport**: the aside would hide and flow 02 would fail. Step 9 runs `./scripts/e2e.sh`.
- **Rollback**: every change is additive or behind CSS classes. Revert the commit, no data or contract involved. `@devdigest/shared` is not touched.

## Untrusted inputs

No new untrusted input. Crumb labels (repo full names, PR numbers from GitHub) were already rendered as React text. The new `title={label}` attribute goes through React attribute escaping, and no `dangerouslySetInnerHTML` is added. Nothing reaches an LLM, shell, SQL or raw HTML.

## Relevant INSIGHTS entries

- `client/INSIGHTS.md` What Works 2026-09-28: dialog stack in mount order (`pushDialog`). ⌘K over the drawer relies on it.
- Recurring Errors 2026-09-30: `<main>` `position: relative` must stay (`AppFrame.tsx:33`); overlays are `position: fixed`, so the drawer is safe.
- Tool & Library Notes 2026-09-28: `MISSING_MESSAGE` only logs, so grep the test output after adding `shell.json` keys.
- Recurring Errors 2026-09-28: Tailwind 4 preflight lives in `styles.css`, and inline style beats a class. That is why D2 uses `!important` utilities.
- Codebase Patterns 2026-09-29: `Modal` body has no padding while `Drawer`'s has 24px, which is why D12 sizes the width against it.
- Tool & Library Notes: `user-event` is absent (for the deferred tests).

## Open questions

- ~~OQ-1~~ resolved: stack on `feat/pr-overview` (PC-1). PR Overview is committed (`f3293b1`, `38bab95`), and `main` lacks the AppFrame fix.
- ~~OQ-2~~ resolved: ADR 0024 lands with this change (site 15; AR-1, PC-6).
- ~~OQ-3~~ resolved by the human: icon search below 1024 (D1, D4). Proportional shrink was rejected.
- ~~OQ-1 (branch)~~ updated by the human: one PR with PR Overview, working directly on `feat/pr-overview`.

## Review log

| Round | Reviewer | Finding | Severity | Resolution |
|---|---|---|---|---|
| 1 | plan-critic | PC-1 base `main` lacks the `<main> position: relative` fix | MAJOR | Fixed: header branch, step 0, R0, OQ-1 resolved |
| 1 | plan-critic | PC-2 `RepoSwitcher` shrink-to-fit in a block Drawer body | MAJOR | Fixed: D11 flex-column wrapper, site 12a, step 9 check |
| 1 | plan-critic | PC-3 left drawer shadow off-screen | MINOR | Fixed: D14, sites 1-2 |
| 1 | plan-critic | PC-4 `title` placement ambiguous | MINOR | Fixed: D4, site 8 |
| 1 | plan-critic | PC-5 Safari focus return; hidden burger after resize | MINOR | Fixed: D15, AC-5 scoped to Chromium, Edge cases |
| 1 | plan-critic | PC-6 ADR marked non-blocking | MINOR | Fixed: site 16, step 8 |
| 1 | architecture-reviewer | AR-1 new responsive pattern without ADR | MEDIUM | Fixed: site 16 (ADR 0024 amends 0003) |
| 1 | architecture-reviewer | AR-2 `.dd-topbar` class splits styling | LOW | Fixed: D3 now uses CSS variables inline |
| 1 | architecture-reviewer | AR-3 (refuted by its verifier) extract `useNavDrawer` | nit | Not adopted (promotion rule); header comment note added to site 12 |
| 1 | architecture-reviewer | OQ: focus after widen-then-close | — | Fixed: D15 |
| 1 | architecture-reviewer | OQ: Topbar/Sidebar/AppFrame absent from Showcase (pre-existing debt) | — | Out of scope; recorded here, not added |
| 2 | plan-critic | PC-1..PC-6 re-checked | — | All resolved |
| 2 | plan-critic | PC-7 proportional shrink truncates the current-page crumb to "…" | MAJOR | Fixed: D4 last crumb `flex: 0 0 auto; maxWidth: 60%`, container `overflow: hidden`, step 9 check |
| 2 | plan-critic | PC-8 drawer content 239px; classic scrollbar | MINOR | Fixed: D12 width 304 (255px content) |
| 2 | plan-critic | PC-9 smoke test never opens the left drawer | MINOR | Fixed: AC-13 reworded; open-state verified via the AppShell drawer in step 9 |
| 2 | plan-critic | PC-10 step 1 grep too narrow / BSD `\|` | MINOR | Fixed: `grep -Eo` on `767px` + eyeball |
| 2 | architecture-reviewer | AR-4 fragment leaks layout contract to consumers | MEDIUM | Fixed: D11 root flex `div` in `SidebarContent`; site 12a and wrapper removed |
| 2 | architecture-reviewer | AR-5 ADR 0003 lacks back-link | LOW | Fixed: site 17, step 8 |
| 2 | architecture-reviewer | OQ: `dd-` naming rule; Showcase hard-codes 288 | — | Fixed: naming rule in site 16; `NAV_DRAWER_WIDTH` exported from `@devdigest/ui` |
| 3 | architecture-reviewer | APPROVE, 0 findings. OQ: D9 wording vs `translateNav`; reuse `:root` at `styles.css:167` | — | Fixed: D9 wording, D3 and site 1 use the existing `:root` |
| 3 | plan-critic | PC-11 60% cap truncates "Pull requests" at 768, contradicting step 9 | MAJOR | Fixed with the critic's proposed text: 75% cap, step 9 check and exception. **Not re-reviewed** (3-round cap reached) |
| 3 | plan-critic | PC-12 change-site numbering gap | MINOR | Fixed: renumbered 1-16. Review-log rows from earlier rounds keep the old numbers |
| — | human (2026-09-30) | Human decisions: OQ-3 → icon search below 1024 (lg breakpoint `max-width: 1023px`, the sidebar stays at 767); ADR 0024 in this change confirmed; PC-11 verified in the browser at step 9 instead of a re-review; work directly on `feat/pr-overview` @ `fe581cb`, one PR | — | Applied: Status, D1, D2, D4 (with 768/900/1023 measurements), G3, AC-2/8/10, sites 1/8/14/15, steps 0/1/9, Edge cases, R4/R6/R7, OQs. No new review loop: the change swaps one class breakpoint and removes the search shrink rules, with no structural change |

## Amendment 2026-10-01

Human decision (Vlad), mobile widths only (below 768px); desktop unchanged.

- **Topbar:** the DevDigest logo (mark + wordmark) is always shown, centered in the header (absolute, `left: 50%`, `dd-show-below-md`). The crumbs row and the Notifications placeholder button hide below md (`dd-hide-below-md`) so nothing collides with the logo; a flex spacer keeps the right-hand icons aligned. At 320px the logo may overlap the icon group by a few px (compact `sm` variant used).
- **Drawer:** the visible "Navigation" title is replaced by the logo in the drawer header. The dialog keeps its accessible name from `shell.navDrawer.title`, rendered as visually hidden text next to the logo inside the `Drawer` title (the `Drawer` API is unchanged: other callers pass both `title` and `ariaLabel`). `SidebarContent` gets `hideLogo` so the logo is not repeated inside the drawer body.
- **Reuse:** the logo markup moved from `SidebarContent` into `vendor/ui/shell/Logo.tsx` (exported from `@devdigest/ui`), used by the sidebar, Topbar and drawer.
- **Tests:** `shell/Topbar.test.tsx`, `components/app-shell/AppShell.test.tsx`.
