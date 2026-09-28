import React from "react";

/** Everything a keyboard user can Tab to. Disabled controls are skipped. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/** Focusable descendants of `root`, in DOM (= Tab) order. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Open dialogs, innermost last. Only the top entry reacts to Escape and Tab, so
 * a Modal opened from inside a Drawer closes alone instead of taking the Drawer
 * with it. Module-level on purpose: every dialog in the tab shares one keyboard.
 */
const stack: { id: symbol; node: HTMLElement }[] = [];

/**
 * Push in open order — except that a dialog never goes above one it contains.
 * When both mount in the same commit, React runs the child's effect first, so
 * plain push order would put the outer dialog on top.
 */
/**
 * The last element focused OUTSIDE any dialog. A field with `autoFocus` is
 * focused during React's commit, before any effect runs, so reading
 * `document.activeElement` in the effect would record that field as the
 * opener and focus restore would do nothing. Tracking focusin (capture) keeps
 * the real opener.
 */
let lastOutsideFocus: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && !t.closest('[role="dialog"]')) lastOutsideFocus = t;
    },
    true,
  );
}

function pushDialog(entry: { id: symbol; node: HTMLElement }) {
  const nested = stack.findIndex((e) => entry.node.contains(e.node));
  if (nested === -1) stack.push(entry);
  else stack.splice(nested, 0, entry);
}

export interface UseDialogFocusOptions {
  /** Defaults to `true` — for dialogs that are mounted only while open. */
  open?: boolean;
  /** Called on Escape. Omit it and Escape does nothing. */
  onClose?: () => void;
  /**
   * What receives focus on open. Falls back to the first focusable descendant,
   * then to the dialog node itself (give it `tabIndex={-1}`).
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Dialog focus management (WAI-ARIA APG "Dialog (Modal)"), without native
 * `<dialog>` — see docs/adr/0009-dialog-focus-management.md.
 *
 * While `open`:
 *  - focus moves into the dialog (unless something inside already has it, e.g.
 *    an `autoFocus` field);
 *  - Tab / Shift+Tab wrap around inside it;
 *  - Escape calls `onClose`, unless an inner control already handled the key
 *    (`event.defaultPrevented` — a listbox or menu closing itself first).
 * On close or unmount focus returns to whatever held it before opening, if that
 * element is still in the document.
 *
 * Keys are read from a `document` listener rather than an `onKeyDown` prop, so
 * they still work after a click on non-focusable dialog content has sent focus
 * to `<body>`. React's root listener runs first, which is what makes the
 * `defaultPrevented` check reliable.
 *
 * Returns the ref to attach to the element that carries `role="dialog"`.
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>({
  open = true,
  onClose,
  initialFocusRef,
}: UseDialogFocusOptions = {}): React.RefObject<T | null> {
  const dialogRef = React.useRef<T | null>(null);
  // Latest-callback ref: call sites pass inline arrows, and re-running the
  // effect on every render would steal focus back to the first field.
  const onCloseRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  React.useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const id = Symbol("dialog");
    pushDialog({ id, node: dialog });
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const opener = active && !dialog.contains(active) ? active : lastOutsideFocus;

    if (!dialog.contains(document.activeElement)) {
      const target = initialFocusRef?.current ?? getFocusable(dialog)[0] ?? dialog;
      target.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (stack[stack.length - 1]?.id !== id) return;
      if (e.key === "Escape") {
        if (e.defaultPrevented || !onCloseRef.current) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const items = getFocusable(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      const inside = dialog.contains(active);
      if (e.shiftKey && (!inside || active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const at = stack.findIndex((e) => e.id === id);
      if (at !== -1) stack.splice(at, 1);
      if (opener && opener.isConnected) opener.focus();
    };
    // initialFocusRef is a ref object (stable identity) and is read at open time only.
  }, [open, initialFocusRef]);

  return dialogRef;
}
