import React from "react";
import { Icon } from "../icons";
import { RowAction } from "../primitives";
import { type DropdownItemDef } from "./types";

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
/** The trigger element, found even while disabled (e.g. a <Button loading>), so
 *  a pending request never flips the wrapper into the div fallback. */
const TRIGGER_SELECTOR = "button, a[href], input, select, textarea, [tabindex]";

function DropdownItem({ it, onActivate }: { it: DropdownItemDef; onActivate: () => void }) {
  const [h, setH] = React.useState(false);
  const I = it.icon ? Icon[it.icon] : null;
  const removeLabel = it.removeLabel ?? "Remove";
  return (
    // The row is a plain container: the item and its remove action are two
    // sibling buttons, because a button nested inside a button is invalid HTML
    // and the inner one is unreachable by keyboard.
    <div
      role="none"
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onFocus={() => setH(true)}
      onBlur={() => setH(false)}
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: 6,
        background: h ? "var(--bg-hover)" : "transparent",
      }}
    >
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          it.onClick?.();
          onActivate();
        }}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          border: "none",
          borderRadius: 6,
          background: "transparent",
          color: it.muted ? "var(--text-secondary)" : "var(--text-primary)",
          fontSize: 14,
          fontWeight: 500,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {I && <I size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
        <span style={{ flex: 1 }}>{it.label}</span>
        {it.hint && (
          <span
            title={it.hint}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {it.hint}
          </span>
        )}
      </button>
      {it.onRemove && (
        <span style={{ display: "inline-flex", marginRight: 8 }}>
          <RowAction
            icon="Trash"
            label={removeLabel}
            tone="danger"
            size={13}
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              it.onRemove?.();
              onActivate();
            }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * Dropdown — a menu button (WAI-ARIA APG "Menu Button").
 *
 * `trigger` is an arbitrary slot, usually a `<Button>` (sometimes wrapped in a
 * span for a tooltip), so the menu-button attributes cannot be passed as props
 * without nesting a button in a button. Instead they are written onto the
 * first focusable element inside the trigger: `aria-haspopup="menu"`,
 * `aria-expanded`, `aria-controls`. A trigger with nothing focusable in it gets
 * `role="button"` + `tabIndex=0` on the wrapper as a fallback (and a dev warning).
 *
 * Keyboard: Enter/Space/ArrowDown on the trigger open the menu with the first
 * item focused (ArrowUp: last); ArrowUp/ArrowDown/Home/End rove over items;
 * Enter/Space activate (native button); Escape closes and returns focus to the
 * trigger; Tab closes and lets focus move on.
 */
export function Dropdown({
  trigger,
  items,
  align = "left",
  width = 230,
}: {
  trigger: React.ReactNode;
  items: DropdownItemDef[];
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerWrapRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  // Which item to focus once the menu has rendered; set by keyboard opens only,
  // so a mouse click leaves focus (and the focus ring) where it was.
  const focusOnOpen = React.useRef<"first" | "last" | null>(null);

  const triggerEl = React.useCallback((): HTMLElement | null => {
    const wrap = triggerWrapRef.current;
    if (!wrap) return null;
    return wrap.querySelector<HTMLElement>(TRIGGER_SELECTOR) ?? wrap;
  }, []);

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Sync the menu-button attributes onto the real trigger element (see above).
  React.useLayoutEffect(() => {
    const el = triggerEl();
    const wrap = triggerWrapRef.current;
    if (!el || !wrap) return;
    if (el === wrap) {
      if (wrap.getAttribute("role") !== "button") {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Dropdown: `trigger` contains no focusable element; pass a <Button> or <button>.");
        }
        wrap.setAttribute("role", "button");
        wrap.tabIndex = 0;
      }
    } else if (wrap.getAttribute("role") === "button") {
      // A real trigger is back (e.g. a disabled Button re-enabled): drop the
      // fallback so the wrapper is not a second tab stop around a <button>.
      wrap.removeAttribute("role");
      wrap.removeAttribute("tabindex");
      wrap.removeAttribute("aria-haspopup");
      wrap.removeAttribute("aria-expanded");
      wrap.removeAttribute("aria-controls");
    }
    el.setAttribute("aria-haspopup", "menu");
    el.setAttribute("aria-expanded", String(open));
    if (open) el.setAttribute("aria-controls", menuId);
    else el.removeAttribute("aria-controls");
  });

  React.useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const list = menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const target = focusOnOpen.current === "first" ? list?.[0] : list?.[list.length - 1];
    focusOnOpen.current = null;
    target?.focus();
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerEl()?.focus();
  };

  const onTriggerClick = (e: React.MouseEvent) => {
    const next = !open;
    // detail === 0 → the click was synthesised by Enter/Space, not a pointer.
    if (next && e.detail === 0) focusOnOpen.current = "first";
    setOpen(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inMenu = !!menuRef.current?.contains(e.target as Node);
    if (!inMenu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        focusOnOpen.current = e.key === "ArrowDown" ? "first" : "last";
        if (open) {
          // Already open (mouse-opened): the effect will not re-run, focus now.
          const list = menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
          const target = e.key === "ArrowDown" ? list?.[0] : list?.[list.length - 1];
          focusOnOpen.current = null;
          target?.focus();
        } else setOpen(true);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        close(true);
      } else if ((e.key === "Enter" || e.key === " ") && e.target === triggerWrapRef.current) {
        // Fallback trigger (a div): no native activation, so do it by hand.
        e.preventDefault();
        focusOnOpen.current = open ? null : "first";
        setOpen(!open);
      }
      return;
    }

    const list = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }} onKeyDown={onKeyDown}>
      <div ref={triggerWrapRef} onClick={onTriggerClick}>
        {trigger}
      </div>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            [align]: 0,
            width,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            padding: 6,
            zIndex: 40,
            animation: "ddpop .12s ease",
          }}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} role="separator" style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
            ) : (
              <DropdownItem key={i} it={it} onActivate={() => close(true)} />
            )
          )}
        </div>
      )}
    </div>
  );
}
