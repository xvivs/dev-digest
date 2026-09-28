import React from "react";
import { Icon } from "../icons";
import { Collapse } from "./Collapse";

export interface DisclosureProps {
  /**
   * Header content, rendered INSIDE the toggle `<button>`. A function receives
   * the current `open` state (e.g. to rotate a `DisclosureChevron`).
   * Must not contain interactive elements — a link or button nested in a button
   * is invalid HTML and unreachable by keyboard. Put those in `actions`.
   */
  header: React.ReactNode | ((open: boolean) => React.ReactNode);
  /**
   * Interactive controls that sit on the header row but do not toggle it
   * (delete, open-in-new-tab). Rendered after the button, outside it.
   */
  actions?: React.ReactNode;
  /** The collapsible body. */
  children: React.ReactNode;
  /** Uncontrolled initial state. Ignored when `open` is passed. */
  defaultOpen?: boolean;
  /** Controlled state. Pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Header row layout (padding, gap, colours) — the visual contract stays with the caller. */
  headerStyle?: React.CSSProperties;
  /** Outer wrapper (card border, background). */
  style?: React.CSSProperties;
}

/** Row that holds the toggle button and the optional `actions`. */
const ROW: React.CSSProperties = { display: "flex", alignItems: "center" };

/** A native button with every browser default stripped, so the header looks like the row it replaces. */
const BUTTON_RESET: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: 0,
  margin: 0,
  border: "none",
  background: "none",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

/**
 * Disclosure — a header that shows and hides one region (WAI-ARIA APG
 * "Disclosure"). The header is a real `<button>` carrying `aria-expanded` and
 * `aria-controls`, so Enter and Space work natively; the body is `Collapse`,
 * so the open/close animation and the unmount-when-closed contract are the
 * same as everywhere else.
 *
 * Header content is a slot, not a set of props: every caller keeps its own
 * icon, title, badges and chevron. `actions` exists because a header row often
 * carries a control of its own, which may not live inside the toggle button.
 */
export function Disclosure({
  header,
  actions,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  headerStyle,
  style,
}: DisclosureProps) {
  const [inner, setInner] = React.useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : inner;
  const bodyId = React.useId();

  const toggle = () => {
    const next = !open;
    if (!controlled) setInner(next);
    onOpenChange?.(next);
  };

  return (
    <div style={style}>
      <div style={{ ...ROW, ...headerStyle }}>
        <button
          type="button"
          data-disclosure=""
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          style={{ ...BUTTON_RESET, gap: headerStyle?.gap ?? BUTTON_RESET.gap }}
        >
          {typeof header === "function" ? header(open) : header}
        </button>
        {actions}
      </div>
      <Collapse open={open} id={bodyId}>
        {children}
      </Collapse>
    </div>
  );
}

/** The rotating chevron every disclosure header here ends with. Decorative. */
export function DisclosureChevron({
  open,
  size = 16,
  style,
}: {
  open: boolean;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <Icon.ChevronDown
      size={size}
      aria-hidden="true"
      style={{
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform .15s",
        color: "var(--text-muted)",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
