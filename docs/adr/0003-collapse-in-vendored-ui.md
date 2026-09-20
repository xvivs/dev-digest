# ADR 0003 — `@devdigest/ui` is editable; `@devdigest/shared` is not

**Status:** accepted
**Date:** 2026-09-20

## Context

Both `CLAUDE.md` and `client/CLAUDE.md` list `*/src/vendor/**` under **Do not
touch**. The rule reads as one rule, but it covers two things that are not alike:

| Path | Mirrored elsewhere? | Why it is "vendor" |
|---|---|---|
| `*/src/vendor/shared/` | **Yes** — `server/` and `client/` each hold a copy | a duplicated contract layer; see [ADR 0001](0001-vendored-shared.md) |
| `client/src/vendor/ui/` | **No** — one copy, one consumer | a design system that happens to live under `vendor/` |

ADR 0001 states the reason the ban exists: the copies have already diverged, and
nothing detects drift. That reasoning is entirely about duplication. It does not
apply to `vendor/ui`, which has no second copy to drift from — it is simply this
app's component library, with its own README, layering rules and a Showcase
gallery that the smoke test mounts.

The question came up concretely. Every collapsible region in the app — the review
run accordion, the finding card, and two rows in the run trace drawer — opened
with `{open && <body/>}`, so the content appeared and vanished in a jump. Fixing
that properly means one shared primitive, not four copies of the same animation.
A cross-feature primitive with four consumers is exactly what a design system is
for; putting it in `src/components/` instead would have meant the design system
was missing a component and the app was quietly routing around it.

## Decision

Split the rule along the line that actually matters — duplication, not the folder
name.

- **`client/src/vendor/ui/` is ordinary, editable source.** Add components to it
  the way `vendor/ui/README.md` already prescribes: one file per component under
  the right layer, exported through that layer's `index.ts`, styled with inline
  `CSSProperties` over CSS variables, **and rendered in
  `src/components/showcase/Showcase.tsx`** — the smoke test mounts that gallery,
  so a component missing from it is a component nobody verifies.
- **`*/src/vendor/shared/` stays untouchable** under the ADR 0001 terms: it is
  duplicated across packages, so either both copies change in one commit, or
  neither does.

The first component landed under this decision is `primitives/Collapse.tsx`,
together with the `ddCollapseIn` / `ddCollapseOut` keyframes in
`vendor/ui/styles.css`.

## Consequences

### What this enables

- Shared UI behaviour has a home again. `Collapse` replaced the same
  `useState` + conditional-render pattern in four places, and carried an
  accessibility fix (`aria-expanded` / `aria-controls`, plus keyboard operation
  on three headers that were bare `div`s) into all of them at once.
- New keyframes belong next to the existing `ddpop` / `ddfadein` rather than in
  `app/globals.css`, so the `prefers-reduced-motion` kill-switch at the bottom of
  `styles.css` covers them automatically.

### What this costs

- `vendor/ui` is no longer a read-only boundary, so "it's in vendor, leave it"
  stops being a sufficient reason on its own. The Showcase requirement is what
  keeps the layer honest — it is the only thing standing between "added a
  component" and "added an unverified component".
- The `vendor/` prefix now means two different things by path. This ADR is the
  disambiguation; the `CLAUDE.md` entries were updated to point at it.

### What this forbids

- Adding a component to `vendor/ui` without adding it to the Showcase.
- Reaching past the barrel into a layer file. `@devdigest/ui` stays the single
  import surface.
- Reading this as permission to edit `vendor/shared`. That ban is unchanged and
  is about drift between two physical copies.

## Alternatives considered

| Option | Why not |
|---|---|
| **Put `Collapse` in `client/src/components/collapse/`** | Respects the letter of the rule and has precedent (`severity-icons`, `findings-popover` live there). Rejected because those are *feature* leaves used by one or two screens, while a disclosure primitive is a design-system concern with four consumers across unrelated features — filing it outside the library would leave the library permanently incomplete. |
| **Add `@radix-ui/react-collapsible`** | The industry default, accessibility included. Rejected as the wrong shape for this codebase: `client/` currently has zero headless-UI or animation dependencies, and `vendor/ui` is a hand-rolled system of inline styles over CSS variables. One primitive is not worth importing a different styling philosophy. |
| **Copy the animation into all four components** | No new files, no rule to bend, and four places to fix the next time the timing or the reduced-motion story changes. |
| **Keep the ban and leave the jump-open behaviour** | The defect is small but it is on the app's busiest screen, and the accessibility gaps travelling with it were not small. |

## Revisit when

- A second package needs `@devdigest/ui`. At that point it has the same
  duplication problem `vendor/shared` has, and it inherits ADR 0001's terms.
- The Showcase stops being mounted by a test, which is the only enforcement this
  decision relies on.
