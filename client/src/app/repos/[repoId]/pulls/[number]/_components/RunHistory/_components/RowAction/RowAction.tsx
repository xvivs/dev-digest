"use client";

import React from "react";
import { Icon, type IconName } from "@devdigest/ui";

/**
 * A bare glyph, no button chrome: a bordered, filled box here would compete
 * with the status badge at the other end of the row for the same attention.
 * The click is stopped from bubbling because the row itself is a button that
 * opens the trace drawer — without this, every trailing action would also
 * fire that.
 */
export function RowAction({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const I = Icon[icon];
  const [h, setH] = React.useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
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
        color: danger && h ? "var(--crit)" : h ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "color .12s",
      }}
    >
      <I size={15} />
    </button>
  );
}
