# ADR 0009 — Dialog focus management through `useDialogFocus`, not native `<dialog>`

**Status:** accepted
**Date:** 2026-09-28

## Context

`Modal` and `Drawer` in `@devdigest/ui` carried `role="dialog"` and nothing
else: no accessible name, no focus on open, no Tab trap, no Escape (audit
finding REACT-7). `ShortcutsHelp` had no Escape at all. `CommandPalette` already
handled focus and Escape by hand. `PromptBlock` opens a `Modal` inside
`RunTraceDrawer`, so the fix has to cope with nested dialogs.

The audit plan (decision D4) weighed native `<dialog>` + `showModal()` against
the hand-rolled approach.

## Decision

- One hook, `useDialogFocus` in `vendor/ui/hooks/`, owns the dialog keyboard
  contract: focus moves in on open, Tab and Shift+Tab wrap inside, Escape calls
  `onClose`, focus returns to the opener on close.
- It listens on `document`, so keys still work after a click on plain dialog
  text sends focus to `<body>`. It skips an Escape that an inner control
  already handled (`defaultPrevented`), so a listbox or menu closes first.
- A module-level stack gives the keyboard to the innermost open dialog only.
  A dialog never goes above one it contains, because React runs the child's
  effect first when both mount in one commit.
- `Modal`, `Drawer`, `CommandPalette` and `ShortcutsHelp` use it and set
  `aria-modal`, plus `aria-labelledby` from the title (or `aria-label`).

## Consequences

### What this enables

- Every dialog in the app behaves the same way, and the jsdom tests cover it
  without a polyfill.
- The existing `ddpop` / `ddslidein` animations and z-index layering stay as
  they are.

### What this costs

- The background is not `inert`. A screen-reader user can still browse outside
  with virtual-cursor keys; `aria-modal` asks assistive tech not to, and
  support varies.
- Edge cases (portals, iframes, a focusable element that is hidden by CSS) stay
  on us. The focusable query does not check visibility.

### What this forbids

- Hand-rolled Escape or focus handling in a new dialog. Use the hook.

## Alternatives considered

| Option | Why not |
|---|---|
| Native `<dialog>` + `showModal()` | Gives the trap, Escape and `inert` for free, but moves dialogs into the top layer (the CSS animations and z-index stacking change), and jsdom support is partial, so every dialog test needs a polyfill. Reopen when jsdom supports `showModal`. |
| A headless library (Radix Dialog, react-aria) | Proven, but `client/` has no headless-UI dependency and ADR 0003 already rejected one for `Collapse`. |
| Fix each component in place | Four copies of the same focus code, which is how `CommandPalette` ended up right and `Modal` wrong. |
