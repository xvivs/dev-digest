import React from "react";
import { Icon, type IconName } from "../icons";

/**
 * Chip — a small pill button, usually one of a filter/toggle row.
 *
 * Passing `active` (true OR false) makes it a toggle: `aria-pressed` mirrors
 * `active` unless `aria-pressed` is given explicitly. Leave `active` undefined
 * for a plain action chip, which then carries no pressed state at all.
 */
export function Chip({
  children,
  active,
  onClick,
  icon,
  count,
  color,
  activeColor,
  disabled,
  title,
  "aria-pressed": ariaPressed,
}: {
  children?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  icon?: IconName;
  count?: number;
  /** Icon colour. */
  color?: string;
  /**
   * Colour of the active state (border + text, on a `--bg-hover` fill) instead
   * of the generic accent — e.g. `SEV[severity].c` for a severity filter.
   */
  activeColor?: string;
  disabled?: boolean;
  title?: string;
  "aria-pressed"?: boolean;
}) {
  const I = icon ? Icon[icon] : null;
  const [h, setH] = React.useState(false);
  const hot = h && !disabled;
  const pressed = ariaPressed ?? active;
  const border = active ? (activeColor ?? "var(--accent)") : "var(--border)";
  const background = active
    ? activeColor
      ? "var(--bg-hover)"
      : "var(--accent-bg)"
    : hot
      ? "var(--bg-hover)"
      : "transparent";
  const fg = disabled
    ? "var(--text-muted)"
    : active
      ? (activeColor ?? "var(--accent-text)")
      : hot
        ? "var(--text-primary)"
        : "var(--text-secondary)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={pressed}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        transition: "all .12s",
        border: "1px solid " + border,
        background,
        color: fg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {I && <I size={13} style={color ? { color } : undefined} />}
      {children}
      {count != null && (
        <span className="tnum" style={{ opacity: 0.7, fontSize: 12 }}>
          {count}
        </span>
      )}
    </button>
  );
}
