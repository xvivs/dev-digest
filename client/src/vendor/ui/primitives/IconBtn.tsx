import React from "react";
import { Icon, type IconName } from "../icons";

export function IconBtn({
  icon,
  label,
  size = 30,
  active,
  onClick,
  danger,
  className,
  hasPopup,
}: {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
  onClick?: () => void;
  danger?: boolean;
  /** Extra class, e.g. a `dd-show-below-*` visibility utility. */
  className?: string;
  /** Renders `aria-haspopup` for triggers that open a dialog. */
  hasPopup?: "dialog";
}) {
  const I = Icon[icon];
  const [h, setH] = React.useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-haspopup={hasPopup}
      className={className}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: size,
        height: size,
        display: "inline-grid",
        placeItems: "center",
        borderRadius: 6,
        border: "1px solid transparent",
        background: h ? "var(--bg-hover)" : active ? "var(--bg-hover)" : "transparent",
        color: danger && h ? "var(--crit)" : active || h ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "background .12s, color .12s",
      }}
    >
      <I size={Math.round(size * 0.52)} />
    </button>
  );
}
