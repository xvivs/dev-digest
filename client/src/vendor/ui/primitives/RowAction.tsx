import React from "react";
import { Icon, type IconName } from "../icons";

/**
 * RowAction — a trailing action on a list row or header (delete, open, copy):
 * a bare glyph with no button chrome.
 *
 * Not `IconBtn`: that one forces a `size × size` box and a `--bg-hover` fill,
 * which compete with whatever the row already shows (status badge, verdict).
 * Hover changes the colour only — `tone="danger"` turns it `--crit`.
 *
 * The click never bubbles: the rows this sits in are usually clickable
 * themselves (open a drawer, toggle a disclosure), and without the stop every
 * trailing action would fire that too.
 *
 * `label` is required — it is the only accessible name an icon-only control has.
 */
/** Glyph colour for a tone and hover state. Hover changes colour only, never the fill. */
export function rowActionColor(tone: "neutral" | "danger", hot: boolean): string {
  if (!hot) return "var(--text-secondary)";
  return tone === "danger" ? "var(--crit)" : "var(--text-primary)";
}

export function RowAction({
  icon,
  label,
  onClick,
  tone = "neutral",
  size = 15,
  disabled,
  busy,
  role,
  tabIndex,
}: {
  icon: IconName;
  /** Accessible name and tooltip. Pass a translated string. */
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** `danger` hovers to `var(--crit)`; `neutral` hovers to `var(--text-primary)`. */
  tone?: "neutral" | "danger";
  /** Glyph size in px. */
  size?: number;
  disabled?: boolean;
  /** An action is in flight: disables the control and spins the glyph. */
  busy?: boolean;
  /** Only for hosts with their own widget role, e.g. `menuitem` inside a `Dropdown`. */
  role?: React.AriaRole;
  tabIndex?: number;
}) {
  const I = Icon[icon];
  const [h, setH] = React.useState(false);
  const off = disabled || busy;
  const hot = h && !off;
  return (
    <button
      type="button"
      role={role}
      tabIndex={tabIndex}
      title={label}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={off}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
        borderRadius: 5,
        border: "none",
        background: "none",
        color: rowActionColor(tone, hot),
        cursor: off ? "not-allowed" : "pointer",
        opacity: disabled && !busy ? 0.5 : 1,
        flexShrink: 0,
        transition: "color .12s",
      }}
    >
      <I size={size} style={busy ? { animation: "ddspin 1s linear infinite" } : undefined} />
    </button>
  );
}
