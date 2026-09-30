# ADR 0024 — Responsive utilities in the vendored UI

**Status:** accepted
**Date:** 2026-09-30
**Amends:** ADR 0003, Decision (inline CSSProperties)

## Context

`@devdigest/ui` styles everything with inline `CSSProperties` over CSS variables
(ADR 0003). Inline styles cannot hold a media query, and the app frame had no
responsive behaviour: the fixed 264px `Sidebar` left a 152px content column at
500px wide and the document scrolled sideways. Between 768 and 1023px the
Topbar painted crumb text over the 260px search button. The only media query in
`styles.css` was `prefers-reduced-motion`.

Show/hide has to be right in the server-rendered HTML, so a `matchMedia` hook
(flash and hydration mismatch) is out.

## Decision

1. **Two breakpoints.** md = `max-width: 767px` switches the sidebar for a
   burger and a left drawer. lg = `max-width: 1023px` switches the full 260px
   search button for a search icon. They differ because the sidebar costs 264px
   of width, and the full search only needs room once the sidebar is present.
2. **Exact complements.** Each inverse rule is written
   `@media not all and (max-width: …)`, not `(min-width: …)`. At fractional CSS
   widths (zoom) `min-width: 768px` and `max-width: 767px` both miss, which
   would show neither the sidebar nor the burger.
3. **Visibility utilities with `!important`.** `.dd-hide-below-md`,
   `.dd-show-below-md`, `.dd-hide-below-lg`, `.dd-show-below-lg` in
   `styles.css`. An author `!important` declaration beats a normal inline
   style, so an element keeps its inline `display` wherever it is visible.
4. **Per-breakpoint values are CSS variables**, read inline:
   `gap: "var(--dd-topbar-gap)"`. They are defined in `:root` and overridden
   under the md media query. No component class, no `!important`.
5. **CSS only.** No `matchMedia`, so server HTML already has the right layout.
6. **Naming.** New layout variables and utility classes take a `dd-` prefix to
   avoid clashing with Tailwind 4 utilities. Existing `--gap`, `.mono`,
   `.skeleton` predate this rule.

This amends ADR 0003 only where it says components are styled with inline
`CSSProperties`: visibility at a breakpoint now comes from these utilities.
Everything else in ADR 0003 stands.

## Consequences

### What this enables

- Responsive show/hide without moving `width`/`display` out of inline styles.
- No layout flash and no hydration mismatch.
- Per-breakpoint tokens stay themeable through CSS variables.

### What this forbids or costs

- `!important` is allowed for these four utilities only. It makes them hard to
  override from a component, which is the point.
- Below 1024px the visible "Search or jump to… ⌘K" hint is an icon; the
  shortcut still works.
- jsdom ignores `styles.css`, so breakpoint behaviour is verified in a browser
  or e2e, not in unit tests.
- Widening the window while the drawer is open leaves it open until closed.

## Alternatives considered

| Option | Why not |
|---|---|
| `matchMedia` hook | Flash on first paint and hydration mismatch |
| Per-element classes carrying `width`/`display` | Splits one element's styling across two places and touches more code |
| `min-width` inverse rules | Dead zone at fractional widths |
| Tailwind responsive utilities | Not used in feature code (ADR 0003) |
| Proportional shrink of the search button | Truncated the current-page crumb to "…" |
