# Spec: Mobile PR detail header (dense layout + collapse on scroll)

**Status:** APPROVED (orchestrator decisions, binding) · **Branch:** `feat/smart-diff` (HEAD `ac539c6`) · **Scope:** `pulls/[number]/_components/PrDetailHeader/**`, `PrDetailView/_components/PrDetailContent/**` (incl. `hooks/useStickyOffset.ts`), `RunReviewDropdown` (one optional prop), route `constants.ts`. Not touched: Smart Diff grouping/findings code, app shell.

## Problem

At 390px the sticky PR header is about 308px tall (about 45% of the viewport) and stays that tall while the user reads the diff.

## Decisions (mobile = below md, 767px; desktop unchanged)

1. **Dense base layout.** Title clamped to 2 lines. One wrapping meta row with smaller gaps. "View on GitHub" and "Run review" become icon buttons with `aria-label` + `title` (Run review keeps the dropdown). Tabs row stays full width and scrolls horizontally if needed. No "Compose review" action exists in this header.
2. **Collapse on scroll.** Two zero-size sentinels sit inside `<main>` at 120px and 40px from the top of its scroll content. An `IntersectionObserver` rooted on `<main>` drives the state: the 120px sentinel leaving the top collapses, the 40px sentinel re-entering expands (hysteresis, no scroll handler). Compact state = one row (`#number` + title on one line with ellipsis + Run review icon) + tabs. Meta row, settled notice and GitHub action are hidden. The meta row animates (`grid-template-rows` 1fr to 0fr + opacity, 200ms ease-out). Tapping the compact title scrolls `<main>` to top (smooth, instant under reduced motion).
3. **No scroll jump.** Collapse shrinks the sticky header and would shorten the flow above the body. The body's `margin-top` is `max(0, --pr-header-full-h - --pr-header-h)`, so total flow height is constant. `useStickyOffset` freezes `--pr-header-full-h` while the source has `data-compact="true"`. `--pr-header-h` keeps tracking the live height through its ResizeObserver, so Smart Diff sticky group headers follow during and after the transition.
4. **Accessibility.** The `<h1>` stays in both states; in compact state it wraps a button whose name is the full title (`title` attribute too). Hidden regions get `inert` (out of tab order and AT tree). If focus sits in a region that collapses, it moves to the compact title button.
5. **Constants** (thresholds, duration, breakpoint query) in the route's `constants.ts`. Reduced motion: transitions are zeroed by the global `prefers-reduced-motion` rule in `styles.css`; the JS branch only switches smooth scroll to instant. No new dependencies.

Mobile detection uses `matchMedia` (`useSyncExternalStore`, server snapshot `false`) in the content hook, because collapse is behaviour, not visibility. The component renders only after data loads, so there is no SSR mismatch.

## Acceptance criteria (EARS)

- **AC-1.** While the viewport is below 768px, the header shall render "View on GitHub" and "Run review" as icon-only buttons with an accessible name and `title`.
- **AC-2.** While the viewport is 768px or wider, the header shall render the same buttons with visible text, exactly as before, and shall never enter the compact state.
- **AC-3.** While mobile and scrollTop is above 120px, the header shall be compact: meta row and GitHub action `inert`/hidden, title on one line.
- **AC-4.** When scrollTop falls below 40px, the header shall expand. Between 40 and 120px the state shall not change.
- **AC-5.** While compact, the `<h1>` shall contain a button whose accessible name includes the full title and whose `title` equals it.
- **AC-6.** When the compact title is activated, the header shall scroll `<main>` to top, smooth unless `prefers-reduced-motion: reduce`.
- **AC-7.** When the header collapses while focus is inside a hidden region, focus shall move to the compact title button.
- **AC-8.** While the header is compact, total flow height above the body shall stay constant and `--pr-header-h` shall equal the live header height.

## Test plan

| AC | File | Case |
|---|---|---|
| 1, 2, 3, 5, 7 | `PrDetailHeader/PrDetailHeader.test.tsx` | props-driven: `mobile`/`compact` |
| 6 | same | `scrollTo` mocked; reduced-motion branch |
| 2, 3, 4 | `PrDetailContent/hooks/useHeaderCollapse.test.tsx` | fake IntersectionObserver, fake matchMedia |
| 8 | `useStickyOffset.test.tsx` | full-height var frozen while `data-compact` |

Layout (heights, sticky alignment) cannot be verified in jsdom: browser QA at 320/390/767.
