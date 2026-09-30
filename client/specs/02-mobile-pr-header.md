# Spec: Mobile PR detail header (dense layout + condensed bar)

**Status:** APPROVED (orchestrator decisions, binding), revised after browser QA · **Branch:** `feat/smart-diff` · **Scope:** `pulls/[number]/_components/PrDetailHeader/**`, `PrDetailView/_components/PrDetailContent/**` (incl. `hooks/useStickyOffset.ts`), `RunReviewDropdown` (one optional prop), route `constants.ts`, `--dd-prh-*` vars in `src/app/globals.css`. Not touched: Smart Diff grouping/findings code, app shell.

## Problem

At 390px the sticky PR header is about 308px tall (about 45% of the viewport) and stays that tall while the user reads the diff.

## Revision (why the design changed)

Round 1 collapsed one sticky header in place (sentinels at 120/40px, margin compensation, a frozen `--pr-header-full-h`). Browser QA measured: **D1** collapsing moved `main.scrollTop` by 100-125px (browser scroll anchoring); **D2** the content wobbled up to 44px, and on expand the flow dipped up to 75px, because the compensation margin and `--pr-header-h` trailed the header by a frame; **D3** the toggle fired 130-280ms after the threshold. Every symptom came from changing the flow height of an element above the content. The new design never changes it.

## Decisions (mobile = below md, 767px; desktop unchanged)

1. **Dense base layout.** Visual differences are `--dd-prh-*` variables (defined in `src/app/globals.css` because they are one route's tokens, overridden at <=767px; ADR 0024): padding, gaps, font sizes, two-line title clamp (`--dd-prh-title-lines`), branch max width. Action labels use `dd-hide-below-md`. "View on GitHub" and "Run review" are single buttons whose label hides below md; aria-label + title are set whenever the layout is not desktop. `#number` never wraps.
2. **Two headers, one sticky.** Desktop: the full header is sticky and measured, as before. Mobile: the full header is `position: static` and scrolls away, so its flow height never changes. A separate `CondensedBar` is a zero-height sticky anchor at the top of `<main>` with an absolutely positioned child of fixed height (88px = 42 title row + 46 tabs row; constants in `constants.ts`). Row 1: `#number` + one-line ellipsis title (a button, `title` = full title, scrolls `<main>` to top) + the Run review icon. Row 2: tabs on one line, horizontal scroll.
3. **Visibility.** One IntersectionObserver (root `<main>`) on a 1px sentinel at the full header's bottom edge. Sentinel gone and above the top edge = `layout: "condensed"` (bar slides in, 180ms ease-out); back in view = hidden. No hysteresis: nothing in the flow changes, so nothing feeds back. `usePrefersReducedMotion` (from `@devdigest/ui`) makes the slide instant and the scroll-to-top non-smooth. The hook sets `overflow-anchor: none` on `<main>` as a guard.
4. **Layout union.** `useCondensedHeader(mobile)` (owned by `PrDetailHeader`, so a bar toggle re-renders only the header subtree, never `PrDetailContent` or the diff) returns `layout: "desktop" | "mobile" | "condensed"`. `matchMedia` is only the behaviour gate (observer on/off, which header is sticky).
5. **A11y.** One `<h1>` (`tabIndex=-1`). The hidden bar is `inert` + `aria-hidden`, so no control in it is reachable. The full header stays live when it scrolls off-screen (off-screen is not hidden), and focus is never moved into the bar: a `focus()` on the still-translated bar scrolled `<main>`. The reverse handoff stays: when the bar is about to go inert while focus is inside it (after a title tap), focus moves to the `<h1>` with `preventScroll`. The two tablists have distinct `aria-label`s ("PR sections", "PR sections (condensed)"). Two `RunReviewDropdown`s share `usePrActiveRuns`, so a run in flight disables both.
6. **Smart Diff offset.** On mobile `--pr-header-h` is the constant `CONDENSED_BAR_HEIGHT` (`useStickyOffset(fixedHeight)`, nothing measured). Desktop keeps the measured value.

## Acceptance criteria (EARS)

- **AC-1.** While the layout is not desktop, the header shall give "View on GitHub" and "Run review" an accessible name and `title`, and hide their labels with `dd-hide-below-md`.
- **AC-2.** While the layout is desktop, the header shall be sticky, show text labels without aria-label/title, and render no bar and no sentinel.
- **AC-3.** While the layout is mobile, the full header shall be `position: static` and the bar shall be `inert`, `aria-hidden` and translated out of view.
- **AC-4.** When the sentinel leaves through the top of `<main>`, the layout shall become condensed and the bar shall be interactive; when it returns, the layout shall become mobile again.
- **AC-5.** While condensed, the bar title shall be a button whose name includes the full title and whose `title` is the full title; activating it shall scroll `<main>` to top (smooth, instant under reduced motion).
- **AC-6.** When the bar is about to hide while focus is inside it, focus shall move to the `<h1>` without scrolling. The header shall not move focus on mount or when the bar appears.
- **AC-9.** When the bar shows or hides, `PrDetailContent` and the diff shall not re-render.
- **AC-7.** While mobile, `--pr-header-h` shall equal `CONDENSED_BAR_HEIGHT`.
- **AC-8.** Showing or hiding the bar shall not change the flow height of `<main>`'s content or `main.scrollTop`.

## Test plan

| AC | File | Case |
|---|---|---|
| 1-6 | `PrDetailHeader/PrDetailHeader.test.tsx` | `mobile` prop + fake IntersectionObserver |
| 9 | `PrDetailView/PrDetailView.test.tsx` | render-count spy on `DiffTab` across a bar toggle |
| 4 | `hooks/useCondensedHeader.test.tsx` | fake IntersectionObserver + matchMedia; below-root ignored; `overflow-anchor` |
| 7 | `hooks/useStickyOffset.test.tsx` | fixed height writes a constant, observes nothing |
| 1 | `RunReviewDropdown.test.tsx` | one button, label behind the utility |

Browser QA (jsdom has no layout): header and bar heights at 320/390/767, `scrollTop` and first-content `top` unchanged across a bar toggle, group headers flush under the bar, tabs on one line, `#n` never wrapped.
