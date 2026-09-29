import React from "react";
import { Icon } from "../icons";

/** REAL controlled checkbox (styled). */
export function Checkbox({
  checked,
  onChange,
  label,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
  /** Accessible name when there is no visible `label` (e.g. a checkbox on a card). */
  "aria-label"?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
          background: checked ? "var(--accent)" : "transparent",
          display: "grid",
          placeItems: "center",
          padding: 0,
        }}
      >
        {checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
      </button>
      {label}
    </label>
  );
}
